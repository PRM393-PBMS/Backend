import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { errorMessage, isEmptyGuid, pbmsPick, pbmsPickGuid, sameStatus } from '../common/pbms-fields';
import { isValidLicensePlate, normalizeLicensePlate } from '../common/license-plate';

@Injectable()
export class VehicleChangeRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: object): Promise<PbmsResponseDto> {
    const subscriptionId = pbmsPickGuid(dto, 'subscriptionId', 'SubscriptionId');
    const newPlate = normalizeLicensePlate(pbmsPick(dto, 'newLicensePlate', 'NewLicensePlate'));
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
      return PbmsResponseDto.fail('Gói vé tháng này hiện đang có một yêu cầu đổi biển số chờ xử lý', 409);
    }
    if (validation.subscription!.licensePlate === newPlate) {
      return PbmsResponseDto.fail('Biển số mới không được trùng với biển số hiện tại');
    }
    try {
      const request = await this.prisma.vehicleChangeRequest.create({
        data: {
          subscriptionId,
          oldLicensePlate: validation.subscription!.licensePlate,
          newLicensePlate: newPlate,
          reason: reason || null,
          status: 'Pending',
        },
      });
      const mapped = await this.loadOne(request.id);
      return PbmsResponseDto.ok('Đã gửi yêu cầu đổi xe thành công', mapped, 201);
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi gửi yêu cầu: ${errorMessage(error)}`, 500);
    }
  }

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.vehicleChangeRequest.findMany({
      include: this.include(),
      orderBy: { createdAt: 'desc' },
    });
    return PbmsResponseDto.ok('Lấy danh sách yêu cầu đổi xe thành công', items.map((item) => this.map(item)));
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const items = await this.prisma.vehicleChangeRequest.findMany({
      where: { subscription: { userId } },
      include: this.include(),
      orderBy: { createdAt: 'desc' },
    });
    return PbmsResponseDto.ok('Lấy yêu cầu đổi xe của tôi thành công', items.map((item) => this.map(item)));
  }

  async getById(id: string, userId: string, canManage: boolean): Promise<PbmsResponseDto> {
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
    await this.prisma.$transaction([
      this.prisma.vehicleChangeRequest.update({
        where: { id },
        data: {
          status: 'Approved',
          processedAt: new Date(),
          handledByStaffId: staffId,
        },
      }),
      this.prisma.monthlySubscription.update({
        where: { id: item.subscriptionId },
        data: { licensePlate: item.newLicensePlate },
      }),
    ]);
    return PbmsResponseDto.ok('Duyệt yêu cầu đổi xe thành công', await this.loadOne(id));
  }

  async reject(id: string, staffId: string, dto: object): Promise<PbmsResponseDto> {
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
    await this.prisma.vehicleChangeRequest.update({
      where: { id },
      data: {
        status: 'Rejected',
        rejectionReason: reason,
        processedAt: new Date(),
        handledByStaffId: staffId,
      },
    });
    return PbmsResponseDto.ok('Từ chối yêu cầu đổi xe thành công', await this.loadOne(id));
  }

  async update(id: string, userId: string, dto: object): Promise<PbmsResponseDto> {
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
    const newPlate = normalizeLicensePlate(pbmsPick(dto, 'newLicensePlate', 'NewLicensePlate'));
    if (!isValidLicensePlate(newPlate)) {
      return PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số');
    }
    await this.prisma.vehicleChangeRequest.update({
      where: { id },
      data: {
        newLicensePlate: newPlate,
        reason: pbmsPick(dto, 'reason', 'Reason').trim() || item.reason,
      },
    });
    return PbmsResponseDto.ok('Cập nhật yêu cầu đổi xe thành công', await this.loadOne(id));
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

  private async validate(userId: string, subscriptionId: string, newPlate: string) {
    if (isEmptyGuid(subscriptionId) || !newPlate) {
      return { subscription: null, error: PbmsResponseDto.fail('Dữ liệu không hợp lệ') };
    }
    if (!isValidLicensePlate(newPlate)) {
      return { subscription: null, error: PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số') };
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) {
      return { subscription: null, error: PbmsResponseDto.fail('Không tìm thấy gói tháng', 404) };
    }
    if (subscription.userId !== userId) {
      return { subscription: null, error: PbmsResponseDto.fail('Bạn không có quyền đổi biển số gói này', 403) };
    }
    if (!sameStatus(subscription.status, 'Active')) {
      return { subscription: null, error: PbmsResponseDto.fail('Chỉ gói đang hiệu lực mới được đổi biển số') };
    }
    return { subscription, error: null };
  }

  private include() {
    return {
      subscription: { include: { user: true, package: true } },
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
