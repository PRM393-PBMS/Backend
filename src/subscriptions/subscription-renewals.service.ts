import { HashingService } from '../auth/services/hashing.service';
import { confirmPassword } from '../common/confirm-password';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InsufficientWalletFundsError, WalletsService } from '../wallets/wallets.service';
import { NotificationsService, formatVnd } from '../notifications/notifications.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { SubscriptionActivationError, extendSubscriptionInTx } from './activate-subscription';
import {
  errorMessage,
  isEmptyGuid,
  pbmsPick,
  pbmsPickDate,
  pbmsPickGuid,
  pbmsPickNumber,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';

const DAY_MS = 864e5;
const vnDate = (date: Date) => date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

@Injectable()
export class SubscriptionRenewalsService {
  private readonly logger = new Logger(SubscriptionRenewalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
    private readonly hashing: HashingService,
    private readonly wallets: WalletsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async renew(subscriptionId: string, userId: string, dto: object): Promise<PbmsResponseDto> {
    const denied = await confirmPassword(this.prisma, this.hashing, userId, dto);
    if (denied) return denied;
    const packageId = pbmsPickGuid(dto, 'packageId', 'PackageId');
    if (isEmptyGuid(packageId)) {
      return PbmsResponseDto.fail('Vui lòng chọn gói gia hạn hợp lệ');
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: subscriptionId },
      include: { vehicle: true },
    });
    if (!subscription) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    if (subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền gia hạn gói này', 403);
    }
    if (sameStatus(subscription.status, 'Cancelled')) {
      return PbmsResponseDto.fail('Không thể gia hạn gói đã hủy');
    }
    // Vé chưa từng thanh toán thì thanh toán vé (kích hoạt, nhận ô), không gia hạn.
    if (!sameStatus(subscription.status, 'Active') && !sameStatus(subscription.status, 'Expired')) {
      return PbmsResponseDto.fail('Vé tháng chưa được kích hoạt, vui lòng thanh toán vé trước', 409);
    }
    const pkg = await this.prisma.subscriptionPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !sameStatus(pkg.status, 'Active')) {
      return PbmsResponseDto.fail('Gói cước gia hạn không tồn tại hoặc đã ngừng áp dụng');
    }
    if (subscription.vehicle.vehicleTypeId !== pkg.vehicleTypeId) {
      return PbmsResponseDto.fail('Gói cước mới không phù hợp với loại xe hiện tại');
    }
    const method = pbmsPick(dto, 'paymentMethod', 'PaymentMethod').trim().toLowerCase();
    if (method && method !== 'payos' && method !== 'wallet') {
      return PbmsResponseDto.fail('Phương thức gia hạn chỉ được là PayOS hoặc Wallet');
    }
    if (method === 'wallet') {
      return this.renewWithWallet(subscription, pkg, userId);
    }
    try {
      const payment = await this.prisma.payment.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          amount: pkg.price,
          paymentMethod: 'PayOS',
          paymentStatus: 'Pending',
          paymentType: 'SubscriptionRenewal',
          paymentTime: new Date(),
          transactionReference: '',
          packageId: pkg.id,
        },
      });
      const link = await this.payos.createPaymentLink(payment);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { transactionReference: link.orderCode },
      });
      return PbmsResponseDto.ok(
        'Tạo thanh toán gia hạn thành công',
        {
          subscriptionId: subscription.id,
          paymentId: payment.id,
          amount: toMoney(payment.amount),
          paymentLinkId: link.paymentLinkId,
          paymentUrl: link.paymentUrl,
          orderCode: link.orderCode,
        },
        201,
      );
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi gia hạn gói: ${errorMessage(error)}`, 500);
    }
  }

  /**
   * Gia hạn trả bằng ví: trừ ví, ghi thanh toán, nối thêm thời hạn của gói đã chọn và
   * lưu lịch sử gia hạn trong cùng một giao dịch. Thiếu tiền thì không đổi gì (402).
   */
  private async renewWithWallet(
    subscription: { id: string },
    pkg: { id: string; price: Prisma.Decimal; durationDays: number },
    userId: string,
  ): Promise<PbmsResponseDto> {
    try {
      const done = await this.chargeRenewal(subscription.id, pkg, userId, 'Gia hạn gói tháng bằng ví');
      return PbmsResponseDto.ok('Gia hạn bằng ví thành công', {
        subscriptionId: subscription.id,
        paymentId: done.payment.id,
        paymentMethod: 'Wallet',
        amount: toMoney(pkg.price),
        walletId: done.debit.walletId,
        walletBalance: toMoney(done.debit.balanceAfter),
        endDate: done.newEnd,
        status: 'Active',
      });
    } catch (error: unknown) {
      if (error instanceof InsufficientWalletFundsError) {
        const balance = await this.wallets.getBalanceForUser(userId);
        return new PbmsResponseDto('Số dư ví không đủ để gia hạn, vui lòng nạp thêm', 402, false, {
          paymentMethod: 'Wallet',
          walletId: balance.walletId,
          walletBalance: balance.walletBalance,
          amount: toMoney(pkg.price),
        });
      }
      if (error instanceof SubscriptionActivationError) {
        return PbmsResponseDto.fail(error.message, 409);
      }
      return PbmsResponseDto.fail(`Lỗi gia hạn gói: ${errorMessage(error)}`, 500);
    }
  }

  /** Trừ ví, ghi thanh toán, nối thêm thời hạn của gói và báo khách, trong một giao dịch. Thiếu tiền thì ném InsufficientWalletFundsError. */
  private async chargeRenewal(
    subscriptionId: string,
    pkg: { id: string; price: Prisma.Decimal; durationDays: number },
    userId: string,
    description: string,
  ) {
    const done = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId,
          subscriptionId,
          amount: pkg.price,
          paymentMethod: 'Wallet',
          paymentStatus: 'Success',
          paymentType: 'SubscriptionRenewal',
          paymentTime: new Date(),
          transactionReference: `WALLET-RNW-${subscriptionId.replace(/-/g, '').slice(0, 12)}`,
          packageId: pkg.id,
        },
      });
      const debit = await this.wallets.debitForUser(tx, userId, pkg.price, 'SubscriptionRenewal', payment.id, description);
      const newEnd = await extendSubscriptionInTx(tx, subscriptionId, pkg.durationDays, pkg.price);
      return { payment, debit, newEnd };
    });
    await this.notifications?.notify(userId, {
      title: 'Đã gia hạn vé tháng',
      message: `Đã trừ ${formatVnd(toMoney(pkg.price))} từ ví PBMS. Vé có hiệu lực đến ${vnDate(done.newEnd)}.`,
      type: 'subscription',
      metadata: { subscriptionId },
    });
    return done;
  }

  /**
   * Mỗi ngày 00:01 (giờ VN), trước cron hết hạn 00:05: vé bật tự gia hạn còn dưới 1 ngày thì trừ ví,
   * cộng một kỳ của gói hiện tại. Vé đã gia hạn có ngày hết hạn xa hơn nên chạy lại không trừ lần hai.
   */
  @Cron('1 0 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async autoRenewFromWallet(): Promise<void> {
    const due = await this.prisma.monthlySubscription.findMany({
      where: { status: 'Active', autoRenew: true, endDate: { lt: new Date(Date.now() + DAY_MS) } },
      include: { package: true, vehicle: { select: { licensePlate: true } } },
    });
    for (const sub of due) {
      const plate = sub.vehicle.licensePlate;
      try {
        if (!sameStatus(sub.package.status, 'Active')) {
          await this.notifications?.notify(sub.userId, {
            title: 'Không tự gia hạn được vé tháng',
            message: `Gói vé tháng xe ${plate} đã ngừng bán. Vui lòng chọn gói khác để gia hạn.`,
            type: 'subscription',
            metadata: { subscriptionId: sub.id },
          });
          continue;
        }
        await this.chargeRenewal(sub.id, sub.package, sub.userId, `Tự gia hạn vé tháng xe ${plate}`);
      } catch (error: unknown) {
        if (error instanceof InsufficientWalletFundsError) {
          const price = toMoney(sub.package.price);
          const { walletBalance } = await this.wallets.getBalanceForUser(sub.userId);
          await this.notifications?.notify(sub.userId, {
            title: 'Không tự gia hạn được vé tháng',
            message: `Ví PBMS không đủ ${formatVnd(price)} để gia hạn vé xe ${plate}. Nạp ví rồi gia hạn trước khi vé hết hạn.`,
            type: 'wallet',
            metadata: { subscriptionId: sub.id, action: 'topup', amount: Math.max(0, Math.ceil(price - walletBalance)) },
          });
        } else {
          this.logger.error(`Tự gia hạn vé ${sub.id} lỗi: ${errorMessage(error)}`);
        }
      }
    }
  }

  /**
   * Mỗi ngày 09:00 (giờ VN): nhắc vé hết hạn sau 3 ngày và ngày mai. Mỗi vé rơi vào mỗi khung 24 giờ
   * đúng một lần nên không cần lưu "đã nhắc". Vé bật tự gia hạn được báo trước số dư có đủ không.
   */
  @Cron('0 9 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async remindExpiring(): Promise<void> {
    const now = Date.now();
    for (const days of [3, 1]) {
      const subs = await this.prisma.monthlySubscription.findMany({
        where: {
          status: 'Active',
          endDate: { gte: new Date(now + days * DAY_MS), lt: new Date(now + (days + 1) * DAY_MS) },
        },
        include: { package: true, vehicle: { select: { licensePlate: true } } },
      });
      for (const sub of subs) {
        const when = days === 1 ? 'ngày mai' : `sau ${days} ngày`;
        let message = `Vé tháng xe ${sub.vehicle.licensePlate} hết hạn ${when} (${vnDate(sub.endDate)}).`;
        if (sub.autoRenew && sameStatus(sub.package.status, 'Active')) {
          const { walletBalance } = await this.wallets.getBalanceForUser(sub.userId);
          const price = toMoney(sub.package.price);
          message +=
            walletBalance >= price
              ? ` Vé sẽ tự gia hạn, trừ ${formatVnd(price)} từ ví PBMS.`
              : ` Ví cần ${formatVnd(price)} để tự gia hạn nhưng chỉ còn ${formatVnd(walletBalance)}, vui lòng nạp thêm.`;
        } else {
          message += ' Gia hạn để tiếp tục gửi xe theo tháng.';
        }
        await this.notifications?.notify(sub.userId, {
          title: 'Vé tháng sắp hết hạn',
          message,
          type: 'subscription',
          metadata: { subscriptionId: sub.id, action: 'renew' },
        });
      }
    }
  }

  async getBySubscription(subscriptionId: string, userId: string, role: string): Promise<PbmsResponseDto> {
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    if (!this.canManage(role) && subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem gia hạn gói này', 403);
    }
    const items = await this.prisma.subscriptionRenewal.findMany({
      where: { subscriptionId },
      orderBy: { renewalDate: 'desc' },
    });
    return PbmsResponseDto.ok('Lấy lịch sử gia hạn thành công', items.map((item) => this.map(item)));
  }

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.subscriptionRenewal.findMany({ orderBy: { renewalDate: 'desc' } });
    return PbmsResponseDto.ok('Lấy danh sách gia hạn thành công', items.map((item) => this.map(item)));
  }

  async getById(id: string, userId: string, role: string): Promise<PbmsResponseDto> {
    const item = await this.prisma.subscriptionRenewal.findUnique({
      where: { id },
      include: { subscription: true },
    });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy gia hạn', 404);
    }
    if (!this.canManage(role) && item.subscription.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem gia hạn này', 403);
    }
    return PbmsResponseDto.ok('Lấy gia hạn thành công', this.map(item));
  }

  async directRenew(dto: object): Promise<PbmsResponseDto> {
    const subscriptionId = pbmsPickGuid(dto, 'subscriptionId', 'SubscriptionId');
    const months = pbmsPickNumber(dto, 'months', 'Months') ?? 0;
    const amount = pbmsPickNumber(dto, 'amount', 'Amount') ?? 0;
    if (isEmptyGuid(subscriptionId) || months <= 0) {
      return PbmsResponseDto.fail('Dữ liệu gia hạn trực tiếp không hợp lệ');
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng', 404);
    }
    const oldEnd = subscription.endDate;
    const start = oldEnd < new Date() ? new Date() : oldEnd;
    const newEnd = new Date(start);
    newEnd.setUTCMonth(newEnd.getUTCMonth() + months);
    const renewal = await this.prisma.$transaction(async (tx) => {
      await tx.monthlySubscription.update({
        where: { id: subscriptionId },
        data: { endDate: newEnd, status: 'Active' },
      });
      return tx.subscriptionRenewal.create({
        data: {
          subscriptionId,
          oldEndDate: oldEnd,
          newEndDate: newEnd,
          amount: new Prisma.Decimal(amount),
          renewalDate: new Date(),
        },
      });
    });
    await this.notifications?.notify(subscription.userId, {
      title: 'Vé tháng đã được gia hạn',
      message: `Ban quản lý đã gia hạn vé tháng của bạn thêm ${months} tháng, hiệu lực đến ${newEnd.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.`,
      type: 'subscription',
      metadata: { subscriptionId, renewalId: renewal.id },
    });
    return PbmsResponseDto.ok('Gia hạn trực tiếp thành công', this.map(renewal), 201);
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'renewalId', 'RenewalId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.subscriptionRenewal.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gia hạn', 404);
    }
    const amount = pbmsPickNumber(dto, 'amount', 'Amount') ?? Number(existing.amount);
    const item = await this.prisma.subscriptionRenewal.update({
      where: { id },
      data: {
        amount: new Prisma.Decimal(amount),
        renewalDate: pbmsPickDate(dto, 'renewalDate', 'RenewalDate') ?? existing.renewalDate,
      },
    });
    return PbmsResponseDto.ok('Cập nhật gia hạn thành công', this.map(item));
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập RenewalId');
    }
    const existing = await this.prisma.subscriptionRenewal.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gia hạn', 404);
    }
    await this.prisma.subscriptionRenewal.delete({ where: { id } });
    return PbmsResponseDto.ok('Xóa gia hạn thành công');
  }

  private canManage(role: string): boolean {
    return role.trim().toLowerCase() === 'manager';
  }

  private map(item: {
    id: string;
    subscriptionId: string;
    oldEndDate: Date;
    newEndDate: Date;
    amount: Prisma.Decimal;
    renewalDate: Date | null;
  }) {
    return {
      renewalId: item.id,
      subscriptionId: item.subscriptionId,
      oldEndDate: item.oldEndDate,
      newEndDate: item.newEndDate,
      amount: toMoney(item.amount),
      renewalDate: item.renewalDate,
    };
  }
}
