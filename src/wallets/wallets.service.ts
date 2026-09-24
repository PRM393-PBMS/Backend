import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPickNumber, toMoney } from '../common/pbms-fields';

export class InsufficientWalletFundsError extends Error {
  constructor() {
    super('Số dư ví không đủ để thanh toán gói này');
    this.name = 'InsufficientWalletFundsError';
  }
}

const TOP_UP_MIN = 2000;
const TOP_UP_MAX = 10_000_000;
const TX_TAKE = 200;

type WalletHistoryFilter = 'TopUp' | 'SubscriptionFee';

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
  ) {}

  async getMine(userId: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    const transactions = await this.loadHistory(userId);
    return PbmsResponseDto.ok('Lấy thông tin ví thành công', {
      userId,
      walletBalance: toMoney(user.walletBalance),
      transactions,
    });
  }

  async listTransactions(userId: string): Promise<PbmsResponseDto> {
    return this.listHistory(userId, undefined, 'Lấy lịch sử ví thành công');
  }

  async listTopUps(userId: string): Promise<PbmsResponseDto> {
    return this.listHistory(userId, 'TopUp', 'Lấy lịch sử nạp ví thành công');
  }

  async listSpends(userId: string): Promise<PbmsResponseDto> {
    return this.listHistory(userId, 'SubscriptionFee', 'Lấy lịch sử chi ví thành công');
  }

  async topUp(userId: string, dto: object): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const amount = pbmsPickNumber(dto, 'amount', 'Amount');
    if (amount === undefined) {
      return PbmsResponseDto.fail('Vui lòng nhập số tiền nạp');
    }
    if (!Number.isInteger(amount) || amount < TOP_UP_MIN || amount > TOP_UP_MAX) {
      return PbmsResponseDto.fail(
        `Số tiền nạp phải là số nguyên từ ${TOP_UP_MIN} đến ${TOP_UP_MAX} VND`,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, walletBalance: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        amount: new Prisma.Decimal(amount),
        paymentMethod: 'PayOS',
        paymentStatus: 'Pending',
        paymentType: 'WalletTopUp',
        paymentTime: new Date(),
        transactionReference: '',
      },
    });

    try {
      const link = await this.payos.createPaymentLink(payment);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { transactionReference: link.orderCode },
      });
      return PbmsResponseDto.ok(
        'Tạo liên kết nạp ví thành công',
        {
          paymentId: payment.id,
          paymentMethod: 'PayOS',
          paymentType: 'WalletTopUp',
          amount,
          walletBalance: toMoney(user.walletBalance),
          paymentLinkId: link.paymentLinkId,
          paymentUrl: link.paymentUrl,
          orderCode: link.orderCode,
        },
        201,
      );
    } catch (error: unknown) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { paymentStatus: 'Failed' },
      });
      const message = error instanceof Error ? error.message : 'Không tạo được liên kết thanh toán PayOS';
      return PbmsResponseDto.fail(message, 500);
    }
  }

  async debitInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: Prisma.Decimal,
    paymentId: string,
  ): Promise<Prisma.Decimal> {
    const debited = await tx.user.updateMany({
      where: { id: userId, walletBalance: { gte: amount } },
      data: { walletBalance: { decrement: amount } },
    });
    if (debited.count !== 1) {
      throw new InsufficientWalletFundsError();
    }
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true },
    });
    const balanceAfter = user?.walletBalance ?? new Prisma.Decimal(0);
    await tx.walletTransaction.create({
      data: {
        userId,
        paymentId,
        type: 'SubscriptionFee',
        amount: amount.negated(),
        balanceAfter,
      },
    });
    return balanceAfter;
  }

  async creditFromPayment(
    tx: Prisma.TransactionClient,
    payment: { id: string; userId: string | null; amount: Prisma.Decimal },
  ): Promise<void> {
    if (!payment.userId) {
      throw new Error(`Không thể cộng ví cho thanh toán ${payment.id}: thiếu UserId.`);
    }
    const existing = await tx.walletTransaction.findUnique({
      where: { paymentId: payment.id },
    });
    if (existing) {
      return;
    }
    const user = await tx.user.update({
      where: { id: payment.userId },
      data: { walletBalance: { increment: payment.amount } },
    });
    await tx.walletTransaction.create({
      data: {
        userId: payment.userId,
        paymentId: payment.id,
        type: 'TopUp',
        amount: payment.amount,
        balanceAfter: user.walletBalance,
      },
    });
  }

  private async listHistory(
    userId: string,
    type: WalletHistoryFilter | undefined,
    message: string,
  ): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    return PbmsResponseDto.ok(message, await this.loadHistory(userId, type));
  }

  private async loadHistory(userId: string, type?: WalletHistoryFilter) {
    const items = await this.prisma.walletTransaction.findMany({
      where: type ? { userId, type } : { userId },
      include: {
        payment: {
          select: {
            id: true,
            subscriptionId: true,
            paymentMethod: true,
            paymentType: true,
            transactionReference: true,
            subscription: {
              select: {
                id: true,
                licensePlate: true,
                package: { select: { packageName: true } },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TX_TAKE,
    });
    return items.map((item) => this.mapTransaction(item));
  }

  private mapTransaction(item: {
    id: string;
    paymentId: string | null;
    type: string;
    amount: Prisma.Decimal;
    balanceAfter: Prisma.Decimal;
    createdAt: Date;
    payment?: {
      id: string;
      subscriptionId: string | null;
      paymentMethod: string;
      paymentType: string | null;
      transactionReference: string | null;
      subscription: {
        id: string;
        licensePlate: string;
        package: { packageName: string } | null;
      } | null;
    } | null;
  }) {
    const signedAmount = toMoney(item.amount);
    const isCredit = item.type === 'TopUp' || signedAmount > 0;
    const packageName = item.payment?.subscription?.package?.packageName ?? null;
    const licensePlate = item.payment?.subscription?.licensePlate ?? null;
    const subscriptionId = item.payment?.subscriptionId ?? item.payment?.subscription?.id ?? null;
    return {
      walletTransactionId: item.id,
      direction: isCredit ? 'Credit' : 'Debit',
      type: item.type,
      amount: signedAmount,
      absoluteAmount: Math.abs(signedAmount),
      balanceAfter: toMoney(item.balanceAfter),
      createdAt: item.createdAt,
      paymentId: item.paymentId ?? item.payment?.id ?? null,
      subscriptionId,
      paymentMethod: item.payment?.paymentMethod ?? (isCredit ? 'PayOS' : 'Wallet'),
      paymentType: item.payment?.paymentType ?? (isCredit ? 'WalletTopUp' : 'SubscriptionFee'),
      orderCode: item.payment?.transactionReference ?? null,
      packageName,
      licensePlate,
      description: isCredit
        ? 'Nạp ví qua PayOS'
        : packageName
          ? `Mua gói tháng ${packageName}${licensePlate ? ` — ${licensePlate}` : ''}`
          : 'Thanh toán gói tháng bằng ví',
    };
  }
}
