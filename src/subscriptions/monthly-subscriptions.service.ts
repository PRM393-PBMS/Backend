import { Injectable, Optional } from '@nestjs/common';
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
import { isMotorbikeType } from '../common/license-plate';
import { InsufficientWalletFundsError, WalletsService } from '../wallets/wallets.service';
import { requiresContract } from '../common/contract-seal';
import { ContractsService } from './contracts.service';
import { HashingService } from '../auth/services/hashing.service';
import { confirmPassword } from '../common/confirm-password';
import { NotificationsService, formatTime, formatVnd } from '../notifications/notifications.service';

type CustomerPaymentMethod = 'PayOS' | 'Wallet';

@Injectable()
export class MonthlySubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
    private readonly wallets: WalletsService,
    private readonly contracts: ContractsService,
    private readonly hashing: HashingService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private notifyWalletActivation(userId: string, subscriptionId: string, amount: Prisma.Decimal) {
    return this.notifications?.notify(userId, {
      title: 'Vé tháng đã kích hoạt',
      message: `Đã trừ ${formatVnd(toMoney(amount))} từ ví PBMS. Vé tháng của bạn đã được kích hoạt.`,
      type: 'subscription',
      metadata: { subscriptionId },
    });
  }

  async register(userId: string, dto: object, createPayment: boolean): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập để đăng ký gói', 401);
    }
    const packageId = pbmsPickGuid(dto, 'packageId', 'PackageId');
    const vehicleId = pbmsPickGuid(dto, 'vehicleId', 'VehicleId');
    const fixedSlotId = pbmsPickGuid(dto, 'fixedSlotId', 'FixedSlotId') || null;
    const requestedParkingId = pbmsPickGuid(dto, 'parkingId', 'ParkingId') || null;
    if (isEmptyGuid(packageId)) {
      return PbmsResponseDto.fail('Vui lòng chọn gói');
    }
    if (isEmptyGuid(vehicleId)) {
      return PbmsResponseDto.fail('Vui lòng chọn xe đã đăng ký');
    }
    const pkg = await this.prisma.subscriptionPackage.findUnique({
      where: { id: packageId },
      include: { vehicleType: true },
    });
    if (!pkg || !sameStatus(pkg.status, 'Active')) {
      return PbmsResponseDto.fail('Gói không tồn tại hoặc đã ngừng bán', 404);
    }
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, userId },
      include: { vehicleType: true },
    });
    if (!vehicle) {
      return PbmsResponseDto.fail('Không tìm thấy xe hoặc xe không thuộc tài khoản của bạn', 404);
    }
    if (vehicle.vehicleTypeId !== pkg.vehicleTypeId) {
      return PbmsResponseDto.fail('Loại xe không phù hợp với gói tháng đã chọn');
    }
    const plateExists = await this.prisma.monthlySubscription.findFirst({
      where: {
        vehicleId,
        status: { in: ['PendingPayment', 'Active'] },
      },
    });
    if (plateExists) {
      // Đơn cũ chưa thanh toán: trả thông tin để app cho khách chọn trả đơn cũ hoặc huỷ đơn cũ.
      if (sameStatus(plateExists.status, 'PendingPayment')) {
        return new PbmsResponseDto(
          'Xe này đang có một đơn vé tháng chưa thanh toán. Hãy thanh toán đơn cũ hoặc huỷ đơn cũ để đăng ký đơn mới.',
          409,
          false,
          { existingSubscriptionId: plateExists.id, status: plateExists.status },
        );
      }
      return PbmsResponseDto.fail('Biển số này đã có gói đang hiệu lực');
    }

    // Bãi áp dụng: gói mọi bãi thì không gắn bãi; gói một bãi thì khách chọn bãi
    // (hoặc lấy theo ô cố định, hoặc bãi duy nhất khi hệ thống chỉ có một bãi).
    let parkingId: string | null = null;
    if (pkg.allParkings) {
      if (fixedSlotId) {
        return PbmsResponseDto.fail('Gói mọi bãi không dùng vị trí đỗ cố định');
      }
    } else {
      const slotParking = fixedSlotId
        ? (await this.prisma.parkingSlot.findUnique({ where: { id: fixedSlotId }, select: { parkingId: true } }))
            ?.parkingId ?? null
        : null;
      parkingId = requestedParkingId ?? slotParking;
      if (!parkingId) {
        const lots = await this.prisma.parking.findMany({ select: { id: true }, take: 2 });
        if (lots.length !== 1) {
          return PbmsResponseDto.fail('Vui lòng chọn bãi đỗ áp dụng vé tháng');
        }
        parkingId = lots[0].id;
      } else if (!(await this.prisma.parking.findUnique({ where: { id: parkingId }, select: { id: true } }))) {
        return PbmsResponseDto.fail('Không tìm thấy bãi đỗ', 404);
      }
      if (slotParking && slotParking !== parkingId) {
        return PbmsResponseDto.fail('Vị trí đỗ cố định không thuộc bãi đã chọn');
      }
    }

    const motorbike = isMotorbikeType(pkg.vehicleType.typeName);
    let selectedSlot: { id: string; slotCode: string } | null = null;
    if (!motorbike && !pkg.allParkings) {
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
            ...(parkingId ? { parkingId } : {}),
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

    const needsContract = createPayment && requiresContract(pkg.durationMonths);
    if (createPayment && !needsContract) {
      const method = this.parseCustomerPaymentMethod(dto);
      if (method.error) {
        return method.error;
      }
      if (method.value === 'Wallet') {
        return this.registerWithWallet(userId, pkg, vehicle, selectedSlot, start, end, parkingId);
      }
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.monthlySubscription.create({
          data: {
            userId,
            vehicleId,
            packageId: pkg.id,
            startDate: start,
            endDate: end,
            price: pkg.price,
            fixedSlotId: selectedSlot?.id ?? null,
            parkingId,
            autoRenew: true,
            status: createPayment ? 'PendingPayment' : 'Active',
          },
        });
        const contract = needsContract
          ? await this.contracts.createForSubscription(tx, subscription.id)
          : null;
        const payment = createPayment && !contract
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
        return { subscription, payment, contract };
      });

      if (created.contract) {
        return PbmsResponseDto.ok(
          'Tạo đăng ký gói thành công, vui lòng ký hợp đồng trước khi thanh toán',
          {
            subscriptionId: created.subscription.id,
            requiresContract: true,
            contractId: created.contract.id,
            contractNumber: created.contract.contractNumber,
            amount: toMoney(created.subscription.price),
            status: 'PendingPayment',
          },
          201,
        );
      }

      if (!created.payment) {
        return PbmsResponseDto.ok(
          'Tạo đăng ký gói thành công',
          this.mapSubscription({
            ...created.subscription,
            user: { fullName: null },
            vehicle,
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
    const updated = await this.prisma.monthlySubscription.update({
      where: { id },
      data: {
        startDate: pbmsPickDate(dto, 'startDate', 'StartDate') ?? existing.startDate,
        endDate: pbmsPickDate(dto, 'endDate', 'EndDate') ?? existing.endDate,
        status: pbmsPick(dto, 'status', 'Status').trim() || existing.status,
        fixedSlotId: pbmsPickGuid(dto, 'fixedSlotId', 'FixedSlotId') || existing.fixedSlotId,
      },
    });
    const item = await this.loadOne(updated.id);
    return PbmsResponseDto.ok('Cập nhật gói tháng thành công', item ? this.mapSubscription(item) : null);
  }

  async cancel(id: string, userId: string, role: string, dto: object = {}): Promise<PbmsResponseDto> {
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
    // Khách tự huỷ: xác thực lại mật khẩu (quản lý huỷ hộ thì không cần).
    if (!this.canManage(role)) {
      const denied = await confirmPassword(this.prisma, this.hashing, userId, dto);
      if (denied) return denied;
    }
    await this.prisma.monthlySubscription.update({
      where: { id },
      data: { status: 'Cancelled' },
    });
    // Đơn chưa thanh toán: đóng link PayOS và thanh toán treo, huỷ hợp đồng chưa ký,
    // để link cũ không kích hoạt lại vé đã huỷ.
    if (sameStatus(existing.status, 'PendingPayment')) {
      await this.closePendingPayments(id);
      await this.prisma.subscriptionContract.updateMany({
        where: { subscriptionId: id, status: 'PendingSignature' },
        data: { status: 'Void' },
      });
    }
    if (existing.fixedSlotId) {
      await this.prisma.parkingSlot.update({
        where: { id: existing.fixedSlotId },
        data: { status: 'Available', assignedUserId: null },
      });
    }
    return PbmsResponseDto.ok('Hủy gói tháng thành công');
  }

  /**
   * Đóng các thanh toán PayOS đang chờ của một vé: huỷ link trên PayOS, đánh dấu Failed.
   * [checkPaid]: hỏi PayOS trước; nếu một link đã được trả thì giữ nguyên và trả true.
   */
  private async closePendingPayments(subscriptionId: string, checkPaid = false): Promise<boolean> {
    const pending = await this.prisma.payment.findMany({
      where: { subscriptionId, paymentStatus: 'Pending', paymentMethod: 'PayOS' },
    });
    for (const p of pending) {
      const orderCode = p.transactionReference?.trim();
      if (orderCode && checkPaid) {
        try {
          const remote = await this.payos.getPaymentStatus(orderCode);
          if (remote.status === 'PAID') return true;
        } catch {
          // PayOS không phản hồi: vẫn đóng ở phía mình, huỷ link bên dưới.
        }
      }
      if (orderCode) {
        await this.payos.cancelPaymentLink(orderCode).catch(() => undefined);
      }
      await this.prisma.payment.updateMany({
        where: { id: p.id, paymentStatus: 'Pending' },
        data: { paymentStatus: 'Failed' },
      });
    }
    return false;
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
      include: { package: true, vehicle: { include: { vehicleType: true } } },
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
    const contract = await this.prisma.subscriptionContract.findUnique({ where: { subscriptionId } });
    if (contract && !sameStatus(contract.status, 'Signed')) {
      return PbmsResponseDto.fail('Vui lòng ký hợp đồng trước khi thanh toán', 409);
    }
    if (method.value === 'Wallet') {
      // Đổi sang trả bằng ví: link PayOS cũ phải đóng trước, nếu không khách có thể trả hai lần.
      const paidElsewhere = await this.closePendingPayments(subscriptionId, true);
      if (paidElsewhere) {
        return PbmsResponseDto.fail('Đơn này đã được thanh toán qua PayOS, vui lòng chờ hệ thống cập nhật', 409);
      }
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
      price: Prisma.Decimal;
      durationDays: number;
    },
    vehicle: { id: string; licensePlate: string; vehicleTypeId: string; vehicleType: { typeName: string } },
    selectedSlot: { id: string; slotCode: string } | null,
    start: Date,
    end: Date,
    parkingId: string | null = null,
  ): Promise<PbmsResponseDto> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.monthlySubscription.create({
          data: {
            userId,
            vehicleId: vehicle.id,
            packageId: pkg.id,
            startDate: start,
            endDate: end,
            price: pkg.price,
            fixedSlotId: selectedSlot?.id ?? null,
            parkingId,
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
        const debit = await this.wallets.debitForUser(
          tx,
          userId,
          pkg.price,
          'SubscriptionFee',
          payment.id,
          `Mua gói tháng — ${vehicle.licensePlate}`,
        );
        await this.activateSubscriptionInTx(tx, {
          ...subscription,
          package: pkg,
          vehicle,
        });
        return { subscription, payment, debit };
      });
      await this.notifyWalletActivation(userId, created.subscription.id, created.payment.amount);
      return PbmsResponseDto.ok(
        'Thanh toán gói bằng ví thành công',
        {
          subscriptionId: created.subscription.id,
          paymentId: created.payment.id,
          paymentMethod: 'Wallet',
          amount: toMoney(created.payment.amount),
          walletId: created.debit.walletId,
          walletBalance: toMoney(created.debit.balanceAfter),
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
      fixedSlotId: string | null;
      price: Prisma.Decimal;
      package: { durationDays: number } | null;
      vehicle: { vehicleTypeId: string; vehicleType: { typeName: string } };
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
        const debit = await this.wallets.debitForUser(
          tx,
          userId,
          subscription.price,
          'SubscriptionFee',
          payment.id,
          'Thanh toán gói tháng bằng ví',
        );
        await this.activateSubscriptionInTx(tx, {
          id: subscription.id,
          userId: subscription.userId,
          fixedSlotId: subscription.fixedSlotId,
          package: subscription.package,
          vehicle: subscription.vehicle,
        });
        return { payment, debit };
      });
      await this.notifyWalletActivation(userId, subscription.id, paid.payment.amount);
      return PbmsResponseDto.ok('Thanh toán gói bằng ví thành công', {
        subscriptionId: subscription.id,
        paymentId: paid.payment.id,
        paymentMethod: 'Wallet',
        amount: toMoney(paid.payment.amount),
        walletId: paid.debit.walletId,
        walletBalance: toMoney(paid.debit.balanceAfter),
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
      fixedSlotId: string | null;
      package: { durationDays: number } | null;
      vehicle: { vehicleTypeId: string; vehicleType: { typeName: string } };
    },
  ): Promise<void> {
    if (!subscription.package) {
      throw new Error(`Không thể kích hoạt gói tháng ${subscription.id}: không tìm thấy thông tin gói đăng ký.`);
    }
    let assignedSlotId = subscription.fixedSlotId;
    if (!isMotorbikeType(subscription.vehicle.vehicleType.typeName)) {
      let slot = subscription.fixedSlotId
        ? await tx.parkingSlot.findUnique({
            where: { id: subscription.fixedSlotId },
            include: { floor: true },
          })
        : null;
      if (!slot) {
        const available = await tx.parkingSlot.findMany({
          where: {
            vehicleTypeId: subscription.vehicle.vehicleTypeId,
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
      if (!slot || slot.vehicleTypeId !== subscription.vehicle.vehicleTypeId || !slot.floor.isResident) {
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
    const snapshot = await this.wallets.getBalanceForUser(userId);
    return new PbmsResponseDto('Số dư ví không đủ để thanh toán gói này', 400, false, {
      paymentMethod: 'Wallet',
      walletId: snapshot.walletId,
      walletBalance: snapshot.walletBalance,
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
        vehicle: { include: { vehicleType: true } },
        package: true,
        fixedSlot: true,
        parking: { select: { id: true, name: true } },
        contract: { select: { id: true, status: true, contractNumber: true } },
      },
      orderBy: { startDate: 'desc' },
    });
    return items.map((item) => this.mapSubscription(item));
  }

  private loadOne(id: string) {
    return this.prisma.monthlySubscription.findUnique({
      where: { id },
      include: {
        user: true,
        vehicle: { include: { vehicleType: true } },
        package: true,
        fixedSlot: true,
        parking: { select: { id: true, name: true } },
        contract: { select: { id: true, status: true, contractNumber: true } },
      },
    });
  }

  private mapSubscription(item: {
    id: string;
    userId: string;
    vehicleId: string;
    startDate: Date;
    endDate: Date;
    price: Prisma.Decimal;
    status: string;
    user?: { fullName: string | null };
    vehicle?: { licensePlate: string; vehicleType: { typeName: string } };
    package?: { packageName: string; durationMonths?: number; durationDays?: number; allParkings?: boolean };
    fixedSlot?: { slotCode: string } | null;
    parkingId?: string | null;
    parking?: { id: string; name: string } | null;
    contract?: { id: string; status: string; contractNumber: string } | null;
  }) {
    return {
      subscriptionId: item.id,
      userId: item.userId,
      vehicleId: item.vehicleId,
      fullName: item.user?.fullName ?? null,
      licensePlate: item.vehicle?.licensePlate ?? null,
      vehicleType: item.vehicle?.vehicleType.typeName ?? null,
      packageName: item.package?.packageName ?? null,
      startDate: item.startDate,
      endDate: item.endDate,
      price: toMoney(item.price),
      status: item.status,
      fixedSlot: item.fixedSlot?.slotCode ?? null,
      parkingId: item.parkingId ?? null,
      parkingName: item.parking?.name ?? null,
      allParkings: item.package?.allParkings ?? false,
      durationMonths: item.package?.durationMonths ?? null,
      contractId: item.contract?.id ?? null,
      contractNumber: item.contract?.contractNumber ?? null,
      contractStatus: item.contract?.status ?? null,
    };
  }
}
