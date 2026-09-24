import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  errorMessage,
  isEmptyGuid,
  pbmsPick,
  pbmsPickDate,
  pbmsPickGuid,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';
import { isMotorbikeType, isValidLicensePlate, normalizeLicensePlate } from '../common/license-plate';

@Injectable()
export class MonthlySubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
  ) {}

  async register(userId: string, dto: object, createPayment: boolean): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập để đăng ký gói', 401);
    }
    const packageId = pbmsPickGuid(dto, 'packageId', 'PackageId');
    const licensePlate = normalizeLicensePlate(pbmsPick(dto, 'licensePlate', 'LicensePlate'));
    const fixedSlotId = pbmsPickGuid(dto, 'fixedSlotId', 'FixedSlotId') || null;
    if (isEmptyGuid(packageId)) {
      return PbmsResponseDto.fail('Vui lòng chọn gói');
    }
    if (!licensePlate) {
      return PbmsResponseDto.fail('Vui lòng nhập biển số xe');
    }
    if (!isValidLicensePlate(licensePlate)) {
      return PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số');
    }
    const pkg = await this.prisma.subscriptionPackage.findUnique({
      where: { id: packageId },
      include: { vehicleType: true },
    });
    if (!pkg || !sameStatus(pkg.status, 'Active')) {
      return PbmsResponseDto.fail('Gói không tồn tại hoặc đã ngừng bán', 404);
    }
    const plateExists = await this.prisma.monthlySubscription.findFirst({
      where: {
        licensePlate,
        status: { in: ['PendingPayment', 'Active'] },
      },
    });
    if (plateExists) {
      return PbmsResponseDto.fail('Biển số này đã có gói đang hiệu lực hoặc đang chờ thanh toán');
    }

    const motorbike = isMotorbikeType(pkg.vehicleType.typeName);
    let selectedSlot: { id: string; slotCode: string } | null = null;
    if (!motorbike) {
      if (pkg.requireFixedSlot) {
        if (!fixedSlotId) {
          return PbmsResponseDto.fail('Vui lòng chọn vị trí đỗ cố định cho gói này');
        }
        const slot = await this.prisma.parkingSlot.findUnique({
          where: { id: fixedSlotId },
          include: { floor: true },
        });
        if (
          !slot ||
          slot.vehicleTypeId !== pkg.vehicleTypeId ||
          !slot.floor.isResident ||
          !sameStatus(slot.status, 'Available')
        ) {
          return PbmsResponseDto.fail(
            'Vị trí đã chọn không khả dụng, không thuộc tầng cư dân hoặc không đúng loại xe',
          );
        }
        selectedSlot = slot;
      } else {
        if (fixedSlotId) {
          return PbmsResponseDto.fail('Gói này không cho phép người dùng tự chọn vị trí');
        }
        const available = await this.prisma.parkingSlot.count({
          where: {
            vehicleTypeId: pkg.vehicleTypeId,
            status: 'Available',
            floor: { isResident: true },
          },
        });
        if (available === 0) {
          return PbmsResponseDto.fail('Không còn vị trí ô tô trống tại tầng cư dân', 409);
        }
      }
    } else if (fixedSlotId) {
      return PbmsResponseDto.fail('Gói xe máy không sử dụng vị trí đỗ cố định');
    }

    const start = new Date();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + pkg.durationDays);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.monthlySubscription.create({
          data: {
            userId,
            vehicleTypeId: pkg.vehicleTypeId,
            licensePlate,
            packageId: pkg.id,
            startDate: start,
            endDate: end,
            price: pkg.price,
            fixedSlotId: selectedSlot?.id ?? null,
            autoRenew: true,
          },
        });
        const payment = createPayment
          ? await tx.payment.create({
              data: {
                userId,
                subscriptionId: subscription.id,
                amount: pkg.price,
                paymentMethod: 'PayOS',
                paymentStatus: 'Pending',
                paymentType: 'SubscriptionFee',
                paymentTime: new Date(),
                transactionReference: '',
              },
            })
          : null;
        return { subscription, payment };
      });

      if (!created.payment) {
        return PbmsResponseDto.ok(
          'Tạo đăng ký gói thành công',
          this.mapSubscription({
            ...created.subscription,
            user: { fullName: null },
            vehicleType: pkg.vehicleType,
            package: pkg,
            fixedSlot: selectedSlot,
          }),
          201,
        );
      }

      const link = await this.payos.createPaymentLink(created.payment);
      await this.prisma.payment.update({
        where: { id: created.payment.id },
        data: { transactionReference: link.orderCode },
      });
      return PbmsResponseDto.ok(
        'Tạo đăng ký gói thành công',
        {
          subscriptionId: created.subscription.id,
          paymentId: created.payment.id,
          orderCode: link.orderCode,
          amount: toMoney(created.payment.amount),
          paymentLinkId: link.paymentLinkId,
          paymentUrl: link.paymentUrl,
        },
        201,
      );
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi đăng ký gói: ${errorMessage(error)}`, 500);
    }
  }

  async createForUser(dto: object): Promise<PbmsResponseDto> {
    const userId = pbmsPickGuid(dto, 'userId', 'UserId');
    return this.register(userId, dto, false);
  }

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.loadMany({});
    return PbmsResponseDto.ok('Lấy danh sách gói tháng thành công', items);
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const items = await this.loadMany({ userId });
    return PbmsResponseDto.ok('Lấy gói tháng của tôi thành công', items);
  }

  async getByUser(userId: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng nhập UserId');
    }
    const items = await this.loadMany({ userId });
    return PbmsResponseDto.ok('Lấy gói tháng theo người dùng thành công', items);
  }

  async getById(id: string, userId: string, role: string): Promise<PbmsResponseDto> {
    const item = await this.loadOne(id);
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    if (!this.canManage(role) && item.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem gói này', 403);
    }
    return PbmsResponseDto.ok('Lấy gói tháng thành công', this.mapSubscription(item));
  }

  async update(id: string, dto: object): Promise<PbmsResponseDto> {
    const existing = await this.prisma.monthlySubscription.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    const licensePlateRaw = pbmsPick(dto, 'licensePlate', 'LicensePlate').trim();
    const licensePlate = licensePlateRaw ? normalizeLicensePlate(licensePlateRaw) : existing.licensePlate;
    if (licensePlateRaw && !isValidLicensePlate(licensePlate)) {
      return PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số');
    }
    const updated = await this.prisma.monthlySubscription.update({
      where: { id },
      data: {
        licensePlate,
        startDate: pbmsPickDate(dto, 'startDate', 'StartDate') ?? existing.startDate,
        endDate: pbmsPickDate(dto, 'endDate', 'EndDate') ?? existing.endDate,
        status: pbmsPick(dto, 'status', 'Status').trim() || existing.status,
        fixedSlotId: pbmsPickGuid(dto, 'fixedSlotId', 'FixedSlotId') || existing.fixedSlotId,
      },
    });
    const item = await this.loadOne(updated.id);
    return PbmsResponseDto.ok('Cập nhật gói tháng thành công', item ? this.mapSubscription(item) : null);
  }

  async cancel(id: string, userId: string, role: string): Promise<PbmsResponseDto> {
    const existing = await this.prisma.monthlySubscription.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    if (!this.canManage(role) && existing.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền hủy gói này', 403);
    }
    if (sameStatus(existing.status, 'Cancelled')) {
      return PbmsResponseDto.fail('Gói đã được hủy');
    }
    await this.prisma.monthlySubscription.update({
      where: { id },
      data: { status: 'Cancelled' },
    });
    if (existing.fixedSlotId) {
      await this.prisma.parkingSlot.update({
        where: { id: existing.fixedSlotId },
        data: { status: 'Available', assignedUserId: null },
      });
    }
    return PbmsResponseDto.ok('Hủy gói tháng thành công');
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    const existing = await this.prisma.monthlySubscription.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    try {
      await this.prisma.monthlySubscription.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa gói tháng thành công');
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi xóa gói tháng: ${errorMessage(error)}`, 500);
    }
  }

  async createPayment(subscriptionId: string, userId: string): Promise<PbmsResponseDto> {
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    if (subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền thanh toán gói này', 403);
    }
    if (sameStatus(subscription.status, 'Active')) {
      return PbmsResponseDto.fail('Gói đã được kích hoạt');
    }
    let payment = await this.prisma.payment.findFirst({
      where: { subscriptionId, paymentStatus: 'Pending', paymentType: 'SubscriptionFee' },
      orderBy: { paymentTime: 'desc' },
    });
    if (!payment) {
      payment = await this.prisma.payment.create({
        data: {
          userId,
          subscriptionId,
          amount: subscription.price,
          paymentMethod: 'PayOS',
          paymentStatus: 'Pending',
          paymentType: 'SubscriptionFee',
          paymentTime: new Date(),
          transactionReference: '',
        },
      });
    }
    const link = await this.payos.createPaymentLink(payment);
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: link.orderCode },
    });
    return PbmsResponseDto.ok('Tạo thanh toán gói thành công', {
      subscriptionId,
      paymentId: payment.id,
      amount: toMoney(payment.amount),
      paymentLinkId: link.paymentLinkId,
      paymentUrl: link.paymentUrl,
      orderCode: link.orderCode,
    });
  }

  private canManage(role: string): boolean {
    const value = role.trim().toLowerCase();
    return value === 'manager' || value === 'admin' || value === 'admin,admin';
  }

  private async loadMany(where: Prisma.MonthlySubscriptionWhereInput) {
    const items = await this.prisma.monthlySubscription.findMany({
      where,
      include: {
        user: true,
        vehicleType: true,
        package: true,
        fixedSlot: true,
      },
      orderBy: { startDate: 'desc' },
    });
    return items.map((item) => this.mapSubscription(item));
  }

  private loadOne(id: string) {
    return this.prisma.monthlySubscription.findUnique({
      where: { id },
      include: { user: true, vehicleType: true, package: true, fixedSlot: true },
    });
  }

  private mapSubscription(item: {
    id: string;
    userId: string;
    licensePlate: string;
    startDate: Date;
    endDate: Date;
    price: Prisma.Decimal;
    status: string;
    user?: { fullName: string | null };
    vehicleType?: { typeName: string };
    package?: { packageName: string };
    fixedSlot?: { slotCode: string } | null;
  }) {
    return {
      subscriptionId: item.id,
      userId: item.userId,
      fullName: item.user?.fullName ?? null,
      licensePlate: item.licensePlate,
      vehicleType: item.vehicleType?.typeName ?? null,
      packageName: item.package?.packageName ?? null,
      startDate: item.startDate,
      endDate: item.endDate,
      price: toMoney(item.price),
      status: item.status,
      fixedSlot: item.fixedSlot?.slotCode ?? null,
    };
  }
}
