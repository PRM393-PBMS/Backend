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
import { InsufficientWalletFundsError, WalletsService } from '../wallets/wallets.service';

type CustomerPaymentMethod = 'PayOS' | 'Wallet';

@Injectable()
export class MonthlySubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
    private readonly wallets: WalletsService,
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

    if (createPayment) {
      const method = this.parseCustomerPaymentMethod(dto);
      if (method.error) {
        return method.error;
      }
      if (method.value === 'Wallet') {
        return this.registerWithWallet(userId, pkg, licensePlate, selectedSlot, start, end);
      }
    }

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
            status: createPayment ? 'PendingPayment' : 'Active',
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
          paymentMethod: 'PayOS',
          orderCode: link.orderCode,
          amount: toMoney(created.payment.amount),
          paymentLinkId: link.paymentLinkId,
          paymentUrl: link.paymentUrl,
          status: 'PendingPayment',
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

  async createPayment(subscriptionId: string, userId: string, dto: object = {}): Promise<PbmsResponseDto> {
    const method = this.parseCustomerPaymentMethod(dto);
    if (method.error) {
      return method.error;
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: subscriptionId },
      include: { package: true, vehicleType: true },
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
    if (method.value === 'Wallet') {
      return this.payPendingWithWallet(subscription, userId);
    }
    let payment = await this.prisma.payment.findFirst({
      where: {
        subscriptionId,
        paymentStatus: 'Pending',
        paymentType: 'SubscriptionFee',
        paymentMethod: 'PayOS',
      },
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
      paymentMethod: 'PayOS',
      amount: toMoney(payment.amount),
      paymentLinkId: link.paymentLinkId,
      paymentUrl: link.paymentUrl,
      orderCode: link.orderCode,
      status: subscription.status,
    });
  }

  private async registerWithWallet(
    userId: string,
    pkg: {
      id: string;
      vehicleTypeId: string;
      price: Prisma.Decimal;
      durationDays: number;
      vehicleType: { typeName: string };
    },
    licensePlate: string,
    selectedSlot: { id: string; slotCode: string } | null,
    start: Date,
    end: Date,
  ): Promise<PbmsResponseDto> {
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
            status: 'PendingPayment',
          },
        });
        const payment = await tx.payment.create({
          data: {
            userId,
            subscriptionId: subscription.id,
            amount: pkg.price,
            paymentMethod: 'Wallet',
            paymentStatus: 'Success',
            paymentType: 'SubscriptionFee',
            paymentTime: new Date(),
            transactionReference: `WALLET-${subscription.id.replace(/-/g, '').slice(0, 12)}`,
          },
        });
        const walletBalance = await this.wallets.debitInTransaction(tx, userId, pkg.price, payment.id);
        await this.activateSubscriptionInTx(tx, {
          ...subscription,
          package: pkg,
          vehicleType: pkg.vehicleType,
        });
        return { subscription, payment, walletBalance };
      });
      return PbmsResponseDto.ok(
        'Thanh toán gói bằng ví thành công',
        {
          subscriptionId: created.subscription.id,
          paymentId: created.payment.id,
          paymentMethod: 'Wallet',
          amount: toMoney(created.payment.amount),
          walletBalance: toMoney(created.walletBalance),
          status: 'Active',
        },
        201,
      );
    } catch (error: unknown) {
      if (error instanceof InsufficientWalletFundsError) {
        return this.insufficientWallet(userId, pkg.price);
      }
      return PbmsResponseDto.fail(`Lỗi đăng ký gói: ${errorMessage(error)}`, 500);
    }
  }

  private async payPendingWithWallet(
    subscription: {
      id: string;
      userId: string;
      vehicleTypeId: string;
      fixedSlotId: string | null;
      price: Prisma.Decimal;
      package: { durationDays: number } | null;
      vehicleType: { typeName: string };
    },
    userId: string,
  ): Promise<PbmsResponseDto> {
    if (!subscription.package) {
      return PbmsResponseDto.fail('Không tìm thấy thông tin gói đăng ký', 404);
    }
    try {
      const paid = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.payment.findFirst({
          where: {
            subscriptionId: subscription.id,
            paymentStatus: 'Pending',
            paymentType: 'SubscriptionFee',
          },
          orderBy: { paymentTime: 'desc' },
        });
        const payment = existing
          ? await tx.payment.update({
              where: { id: existing.id },
              data: {
                paymentMethod: 'Wallet',
                paymentStatus: 'Success',
                paymentTime: new Date(),
                transactionReference:
                  existing.transactionReference?.trim() ||
                  `WALLET-${subscription.id.replace(/-/g, '').slice(0, 12)}`,
              },
            })
          : await tx.payment.create({
              data: {
                userId,
                subscriptionId: subscription.id,
                amount: subscription.price,
                paymentMethod: 'Wallet',
                paymentStatus: 'Success',
                paymentType: 'SubscriptionFee',
                paymentTime: new Date(),
                transactionReference: `WALLET-${subscription.id.replace(/-/g, '').slice(0, 12)}`,
              },
            });
        const walletBalance = await this.wallets.debitInTransaction(
          tx,
          userId,
          subscription.price,
          payment.id,
        );
        await this.activateSubscriptionInTx(tx, {
          id: subscription.id,
          userId: subscription.userId,
          vehicleTypeId: subscription.vehicleTypeId,
          fixedSlotId: subscription.fixedSlotId,
          package: subscription.package,
          vehicleType: subscription.vehicleType,
        });
        return { payment, walletBalance };
      });
      return PbmsResponseDto.ok('Thanh toán gói bằng ví thành công', {
        subscriptionId: subscription.id,
        paymentId: paid.payment.id,
        paymentMethod: 'Wallet',
        amount: toMoney(paid.payment.amount),
        walletBalance: toMoney(paid.walletBalance),
        status: 'Active',
      });
    } catch (error: unknown) {
      if (error instanceof InsufficientWalletFundsError) {
        return this.insufficientWallet(userId, subscription.price);
      }
      return PbmsResponseDto.fail(`Lỗi thanh toán gói: ${errorMessage(error)}`, 500);
    }
  }

  private async activateSubscriptionInTx(
    tx: Prisma.TransactionClient,
    subscription: {
      id: string;
      userId: string;
      vehicleTypeId: string;
      fixedSlotId: string | null;
      package: { durationDays: number } | null;
      vehicleType: { typeName: string };
    },
  ): Promise<void> {
    if (!subscription.package) {
      throw new Error(`Không thể kích hoạt gói tháng ${subscription.id}: không tìm thấy thông tin gói đăng ký.`);
    }
    let assignedSlotId = subscription.fixedSlotId;
    if (!isMotorbikeType(subscription.vehicleType.typeName)) {
      let slot = subscription.fixedSlotId
        ? await tx.parkingSlot.findUnique({
            where: { id: subscription.fixedSlotId },
            include: { floor: true },
          })
        : null;
      if (!slot) {
        const available = await tx.parkingSlot.findMany({
          where: {
            vehicleTypeId: subscription.vehicleTypeId,
            status: 'Available',
            floor: { isResident: true },
          },
          include: { floor: true },
        });
        if (available.length === 0) {
          throw new Error(
            `Không thể kích hoạt gói tháng ${subscription.id}: không còn slot cư dân phù hợp với loại xe.`,
          );
        }
        slot = available[Math.floor(Math.random() * available.length)];
      }
      if (!slot || slot.vehicleTypeId !== subscription.vehicleTypeId || !slot.floor.isResident) {
        throw new Error(
          `Không thể kích hoạt gói tháng ${subscription.id}: slot cố định không tồn tại hoặc không còn hợp lệ.`,
        );
      }
      await tx.parkingSlot.update({
        where: { id: slot.id },
        data: { status: 'Assigned', assignedUserId: subscription.userId },
      });
      assignedSlotId = slot.id;
    }
    const start = new Date();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + subscription.package.durationDays);
    await tx.monthlySubscription.update({
      where: { id: subscription.id },
      data: { status: 'Active', startDate: start, endDate: end, autoRenew: true, fixedSlotId: assignedSlotId },
    });
  }

  private parseCustomerPaymentMethod(dto: object): {
    value: CustomerPaymentMethod;
    error: PbmsResponseDto | null;
  } {
    const raw = pbmsPick(dto, 'paymentMethod', 'PaymentMethod').trim();
    if (!raw || raw.toLowerCase() === 'payos') {
      return { value: 'PayOS', error: null };
    }
    if (raw.toLowerCase() === 'wallet') {
      return { value: 'Wallet', error: null };
    }
    return {
      value: 'PayOS',
      error: PbmsResponseDto.fail('Phương thức thanh toán gói chỉ được là PayOS hoặc Wallet'),
    };
  }

  private async insufficientWallet(userId: string, amount: Prisma.Decimal): Promise<PbmsResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true },
    });
    return new PbmsResponseDto('Số dư ví không đủ để thanh toán gói này', 400, false, {
      paymentMethod: 'Wallet',
      walletBalance: toMoney(user?.walletBalance),
      amount: toMoney(amount),
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
