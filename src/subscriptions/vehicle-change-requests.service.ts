import { AppError } from '../common/errors';
import { lockResource } from '../common/transactions';
import { HashingService } from '../auth/services/hashing.service';
import { confirmPassword } from '../common/confirm-password';
import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  isEmptyGuid,
  pbmsPick,
  pbmsPickGuid,
  sameStatus,
} from '../common/pbms-fields';
import {
  isValidLicensePlate,
  normalizeLicensePlate,
  PLATE_FORMAT_MESSAGE,
} from '../common/license-plate';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class VehicleChangeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async create(userId: string, dto: object): Promise<PbmsResponseDto> {
    const denied = await confirmPassword(
      this.prisma,
      this.hashing,
      userId,
      dto,
    );
    if (denied) return denied;
    const subscriptionId = pbmsPickGuid(
      dto,
      'subscriptionId',
      'SubscriptionId',
    );
    const newPlate = normalizeLicensePlate(
      pbmsPick(dto, 'newLicensePlate', 'NewLicensePlate'),
    );
    const reason = pbmsPick(dto, 'reason', 'Reason').trim();
    if (reason.length > 500) {
      return PbmsResponseDto.fail('Lý do không được vượt quá 500 ký tự');
    }
    const validation = await this.validate(userId, subscriptionId, newPlate);
    if (validation.error) {
      return validation.error;
    }
    const pending = await this.prisma.vehicleChangeRequest.findFirst({
      where: { subscriptionId, status: 'Pending' },
    });
    if (pending) {
      return PbmsResponseDto.fail(
        'Gói vé tháng này hiện đang có một yêu cầu đổi biển số chờ xử lý',
        409,
      );
    }
    if (validation.subscription!.vehicle?.licensePlate === newPlate) {
      return PbmsResponseDto.fail(
        'Biển số mới không được trùng với biển số hiện tại',
      );
    }
    try {
      const request = await this.prisma.vehicleChangeRequest.create({
        data: {
          subscriptionId,
          oldLicensePlate: validation.subscription!.vehicle!.licensePlate,
          newLicensePlate: newPlate,
          reason: reason || null,
          status: 'Pending',
        },
      });
      const mapped = await this.loadOne(request.id);
      return PbmsResponseDto.ok(
        'Đã gửi yêu cầu đổi xe thành công',
        mapped,
        201,
      );
    } catch (error: unknown) {
      return PbmsResponseDto.fromError(error);
    }
  }

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.vehicleChangeRequest.findMany({
      include: this.include(),
      orderBy: { createdAt: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách yêu cầu đổi xe thành công',
      items.map((item) => this.map(item)),
    );
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const items = await this.prisma.vehicleChangeRequest.findMany({
      where: { subscription: { userId } },
      include: this.include(),
      orderBy: { createdAt: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy yêu cầu đổi xe của tôi thành công',
      items.map((item) => this.map(item)),
    );
  }

  async getById(
    id: string,
    userId: string,
    canManage: boolean,
  ): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập RequestId');
    }
    const item = await this.loadRecord(id);
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy yêu cầu đổi xe', 404);
    }
    if (!canManage && item.subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem yêu cầu này', 403);
    }
    return PbmsResponseDto.ok('Lấy yêu cầu đổi xe thành công', this.map(item));
  }

  async approve(id: string, staffId: string): Promise<PbmsResponseDto> {
    const item = await this.loadRecord(id);
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy yêu cầu đổi xe', 404);
    }
    if (!sameStatus(item.status, 'Pending')) {
      return PbmsResponseDto.fail('Chỉ yêu cầu đang chờ mới được duyệt');
    }
    await this.prisma.$transaction(async (tx) => {
      await lockResource(tx, 'gate-entry');
      await lockResource(tx, 'subscription:' + item.subscriptionId);
      const request = await tx.vehicleChangeRequest.findUniqueOrThrow({
        where: { id },
      });
      const vehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: item.subscription.vehicleId },
      });
      const inside = await tx.parkingSession.findFirst({
        where: {
          vehicleId: vehicle.id,
          status: { in: ['Active', 'Exception'] },
        },
      });
      if (inside || vehicle.licensePlate !== request.oldLicensePlate)
        throw new AppError(
          409,
          'VEHICLE_STATE_CHANGED',
          'Xe đang trong bãi hoặc biển số đã thay đổi',
        );
      const moved = await tx.vehicleChangeRequest.updateMany({
        where: { id, status: 'Pending' },
        data: {
          status: 'Approved',
          processedAt: new Date(),
          handledByStaffId: staffId,
        },
      });
      if (moved.count !== 1)
        throw new AppError(409, 'REQUEST_CLOSED', 'Yêu cầu đã được xử lý');
      await tx.vehicle.update({
        where: { id: item.subscription.vehicleId! },
        data: { licensePlate: item.newLicensePlate },
      });
    });
    await this.notifications?.notify(item.subscription.userId, {
      title: 'Yêu cầu đổi biển số đã được duyệt',
      message: `Vé tháng của bạn đã chuyển từ biển số ${item.oldLicensePlate} sang ${item.newLicensePlate}.`,
      type: 'subscription',
      metadata: {
        requestId: id,
        subscriptionId: item.subscriptionId,
        status: 'Approved',
      },
    });
    return PbmsResponseDto.ok(
      'Duyệt yêu cầu đổi xe thành công',
      await this.loadOne(id),
    );
  }

  async reject(
    id: string,
    staffId: string,
    dto: object,
  ): Promise<PbmsResponseDto> {
    const item = await this.loadRecord(id);
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy yêu cầu đổi xe', 404);
    }
    if (!sameStatus(item.status, 'Pending')) {
      return PbmsResponseDto.fail('Chỉ yêu cầu đang chờ mới được từ chối');
    }
    const reason = pbmsPick(dto, 'reason', 'Reason').trim();
    if (!reason) {
      return PbmsResponseDto.fail('Vui lòng nhập lý do từ chối');
    }
    const moved = await this.prisma.vehicleChangeRequest.updateMany({
      where: { id, status: 'Pending' },
      data: {
        status: 'Rejected',
        rejectionReason: reason,
        processedAt: new Date(),
        handledByStaffId: staffId,
      },
    });
    if (moved.count !== 1)
      return PbmsResponseDto.fail('Yêu cầu đã được xử lý', 409);
    await this.notifications?.notify(item.subscription.userId, {
      title: 'Yêu cầu đổi biển số bị từ chối',
      message: `Yêu cầu đổi sang biển số ${item.newLicensePlate} bị từ chối. Lý do: ${reason}`,
      type: 'subscription',
      metadata: {
        requestId: id,
        subscriptionId: item.subscriptionId,
        status: 'Rejected',
        rejectionReason: reason,
      },
    });
    return PbmsResponseDto.ok(
      'Từ chối yêu cầu đổi xe thành công',
      await this.loadOne(id),
    );
  }

  async update(
    id: string,
    userId: string,
    dto: object,
  ): Promise<PbmsResponseDto> {
    const denied = await confirmPassword(
      this.prisma,
      this.hashing,
      userId,
      dto,
    );
    if (denied) return denied;
    const item = await this.loadRecord(id);
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy yêu cầu đổi xe', 404);
    }
    if (item.subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền sửa yêu cầu này', 403);
    }
    if (!sameStatus(item.status, 'Pending')) {
      return PbmsResponseDto.fail('Chỉ yêu cầu đang chờ mới được cập nhật');
    }
    const newPlate = normalizeLicensePlate(
      pbmsPick(dto, 'newLicensePlate', 'NewLicensePlate'),
    );
    if (!isValidLicensePlate(newPlate)) {
      return PbmsResponseDto.fail(PLATE_FORMAT_MESSAGE);
    }
    const moved = await this.prisma.vehicleChangeRequest.updateMany({
      where: { id, status: 'Pending' },
      data: {
        newLicensePlate: newPlate,
        reason: pbmsPick(dto, 'reason', 'Reason').trim() || item.reason,
      },
    });
    if (moved.count !== 1)
      return PbmsResponseDto.fail('Yêu cầu đã được xử lý', 409);
    return PbmsResponseDto.ok(
      'Cập nhật yêu cầu đổi xe thành công',
      await this.loadOne(id),
    );
  }

  async remove(id: string, userId: string): Promise<PbmsResponseDto> {
    const item = await this.loadRecord(id);
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy yêu cầu đổi xe', 404);
    }
    if (item.subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xóa yêu cầu này', 403);
    }
    if (!sameStatus(item.status, 'Pending')) {
      return PbmsResponseDto.fail('Chỉ yêu cầu đang chờ mới được xóa');
    }
    await this.prisma.vehicleChangeRequest.delete({ where: { id } });
    return PbmsResponseDto.ok('Xóa yêu cầu đổi xe thành công');
  }

  private async validate(
    userId: string,
    subscriptionId: string,
    newPlate: string,
  ) {
    if (isEmptyGuid(subscriptionId) || !newPlate) {
      return {
        subscription: null,
        error: PbmsResponseDto.fail('Dữ liệu không hợp lệ'),
      };
    }
    if (!isValidLicensePlate(newPlate)) {
      return {
        subscription: null,
        error: PbmsResponseDto.fail(PLATE_FORMAT_MESSAGE),
      };
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: subscriptionId },
      include: { vehicle: true },
    });
    if (!subscription) {
      return {
        subscription: null,
        error: PbmsResponseDto.fail('Không tìm thấy gói tháng', 404),
      };
    }
    if (subscription.userId !== userId) {
      return {
        subscription: null,
        error: PbmsResponseDto.fail(
          'Bạn không có quyền đổi biển số gói này',
          403,
        ),
      };
    }
    if (!sameStatus(subscription.status, 'Active')) {
      return {
        subscription: null,
        error: PbmsResponseDto.fail(
          'Chỉ gói đang hiệu lực mới được đổi biển số',
        ),
      };
    }
    if (!subscription.vehicle) {
      return {
        subscription: null,
        error: PbmsResponseDto.fail('Gói tháng chưa được liên kết với xe', 409),
      };
    }
    return { subscription, error: null };
  }

  private include() {
    return {
      subscription: { include: { user: true, vehicle: true, package: true } },
      handledByStaff: true,
    } as const;
  }

  private loadRecord(id: string) {
    return this.prisma.vehicleChangeRequest.findUnique({
      where: { id },
      include: this.include(),
    });
  }

  private async loadOne(id: string) {
    const item = await this.loadRecord(id);
    return item ? this.map(item) : null;
  }

  private map(item: {
    id: string;
    subscriptionId: string;
    oldLicensePlate: string;
    newLicensePlate: string;
    reason: string | null;
    rejectionReason: string | null;
    status: string;
    createdAt: Date | null;
    processedAt: Date | null;
    handledByStaffId: string | null;
    subscription: {
      user: { fullName: string | null };
      package: { packageName: string };
    };
    handledByStaff: { fullName: string | null } | null;
  }) {
    return {
      requestId: item.id,
      subscriptionId: item.subscriptionId,
      oldLicensePlate: item.oldLicensePlate,
      newLicensePlate: item.newLicensePlate,
      reason: item.reason,
      rejectionReason: item.rejectionReason,
      status: item.status,
      createdAt: item.createdAt,
      processedAt: item.processedAt,
      userFullName: item.subscription.user.fullName,
      packageName: item.subscription.package.packageName,
      handledByStaffId: item.handledByStaffId,
      handledByFullName: item.handledByStaff?.fullName ?? null,
    };
  }
}
