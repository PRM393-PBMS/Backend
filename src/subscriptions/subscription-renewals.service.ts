import { HashingService } from '../auth/services/hashing.service';
import { confirmPassword } from '../common/confirm-password';
import { Injectable, Optional } from '@nestjs/common';
import { InsufficientWalletFundsError, WalletsService } from '../wallets/wallets.service';
import { NotificationsService, formatVnd } from '../notifications/notifications.service';
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
  pbmsPickNumber,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';

@Injectable()
export class SubscriptionRenewalsService {
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
    subscription: { id: string; endDate: Date },
    pkg: { id: string; price: Prisma.Decimal; durationDays: number },
    userId: string,
  ): Promise<PbmsResponseDto> {
    try {
      const done = await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            userId,
            subscriptionId: subscription.id,
            amount: pkg.price,
            paymentMethod: 'Wallet',
            paymentStatus: 'Success',
            paymentType: 'SubscriptionRenewal',
            paymentTime: new Date(),
            transactionReference: `WALLET-RNW-${subscription.id.replace(/-/g, '').slice(0, 12)}`,
          },
        });
        const debit = await this.wallets.debitForUser(
          tx,
          userId,
          pkg.price,
          'SubscriptionRenewal',
          payment.id,
          'Gia hạn gói tháng bằng ví',
        );
        // Còn hạn thì nối tiếp từ ngày hết hạn, đã hết hạn thì tính từ hôm nay.
        const oldEnd = subscription.endDate;
        const start = oldEnd < new Date() ? new Date() : oldEnd;
        const newEnd = new Date(start);
        newEnd.setUTCDate(newEnd.getUTCDate() + pkg.durationDays);
        await tx.monthlySubscription.update({
          where: { id: subscription.id },
          data: { endDate: newEnd, status: 'Active' },
        });
        await tx.subscriptionRenewal.create({
          data: {
            subscriptionId: subscription.id,
            oldEndDate: oldEnd,
            newEndDate: newEnd,
            amount: pkg.price,
            renewalDate: new Date(),
          },
        });
        return { payment, debit, newEnd };
      });
      await this.notifications?.notify(userId, {
        title: 'Đã gia hạn vé tháng',
        message: `Đã trừ ${formatVnd(toMoney(pkg.price))} từ ví PBMS. Vé có hiệu lực đến ${done.newEnd.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.`,
        type: 'subscription',
        metadata: { subscriptionId: subscription.id },
      });
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
      return PbmsResponseDto.fail(`Lỗi gia hạn gói: ${errorMessage(error)}`, 500);
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
