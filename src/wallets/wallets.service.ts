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
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WalletHistoryFilter = 'TopUp' | 'SubscriptionFee';
type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
  ) {}

  async ensureMine(userId: string): Promise<PbmsResponseDto> {
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
    const wallet = await this.ensureWallet(this.prisma, userId);
    return PbmsResponseDto.ok('Mở ví thành công', this.mapWalletSummary(wallet));
  }

  async getById(userId: string, walletId: string): Promise<PbmsResponseDto> {
    const owned = await this.requireOwnedWallet(userId, walletId);
    if (owned.error) {
      return owned.error;
    }
    const transactions = await this.loadHistory(owned.wallet.id);
    return PbmsResponseDto.ok('Lấy thông tin ví thành công', {
      ...this.mapWalletSummary(owned.wallet),
      transactions,
    });
  }

  async listTransactions(userId: string, walletId: string): Promise<PbmsResponseDto> {
    return this.listHistory(userId, walletId, undefined, 'Lấy lịch sử ví thành công');
  }

  async listTopUps(userId: string, walletId: string): Promise<PbmsResponseDto> {
    return this.listHistory(userId, walletId, 'TopUp', 'Lấy lịch sử nạp ví thành công');
  }

  async listSpends(userId: string, walletId: string): Promise<PbmsResponseDto> {
    return this.listHistory(userId, walletId, 'SubscriptionFee', 'Lấy lịch sử chi ví thành công');
  }

  async topUp(userId: string, walletId: string, dto: object): Promise<PbmsResponseDto> {
    const owned = await this.requireOwnedWallet(userId, walletId);
    if (owned.error) {
      return owned.error;
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
          walletId: owned.wallet.id,
          paymentId: payment.id,
          paymentMethod: 'PayOS',
          paymentType: 'WalletTopUp',
          amount,
          walletBalance: toMoney(owned.wallet.balance),
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
  ): Promise<{ walletId: string; balanceAfter: Prisma.Decimal }> {
    const wallet = await this.ensureWallet(tx, userId);
    const debited = await tx.wallet.updateMany({
      where: { id: wallet.id, userId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) {
      throw new InsufficientWalletFundsError();
    }
    const updated = await tx.wallet.findUnique({
      where: { id: wallet.id },
      select: { balance: true },
    });
    const balanceAfter = updated?.balance ?? new Prisma.Decimal(0);
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        paymentId,
        type: 'SubscriptionFee',
        amount: amount.negated(),
        balanceAfter,
      },
    });
    return { walletId: wallet.id, balanceAfter };
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
    const wallet = await this.ensureWallet(tx, payment.userId);
    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: payment.amount } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        paymentId: payment.id,
        type: 'TopUp',
        amount: payment.amount,
        balanceAfter: updated.balance,
      },
    });
  }

  async getBalanceForUser(userId: string): Promise<{
    walletId: string | null;
    walletBalance: number;
  }> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, balance: true },
    });
    return {
      walletId: wallet?.id ?? null,
      walletBalance: toMoney(wallet?.balance),
    };
  }

  private async listHistory(
    userId: string,
    walletId: string,
    type: WalletHistoryFilter | undefined,
    message: string,
  ): Promise<PbmsResponseDto> {
    const owned = await this.requireOwnedWallet(userId, walletId);
    if (owned.error) {
      return owned.error;
    }
    return PbmsResponseDto.ok(message, await this.loadHistory(owned.wallet.id, type));
  }

  private async requireOwnedWallet(
    userId: string,
    walletId: string,
  ): Promise<{ wallet: { id: string; userId: string; balance: Prisma.Decimal }; error?: never } | { wallet?: never; error: PbmsResponseDto }> {
    if (isEmptyGuid(userId)) {
      return { error: PbmsResponseDto.fail('Vui lòng đăng nhập', 401) };
    }
    if (isEmptyGuid(walletId) || !UUID_RE.test(walletId)) {
      return { error: PbmsResponseDto.fail('Vui lòng nhập WalletId hợp lệ') };
    }
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { id: true, userId: true, balance: true },
    });
    if (!wallet) {
      return { error: PbmsResponseDto.fail('Không tìm thấy ví', 404) };
    }
    if (wallet.userId !== userId) {
      return { error: PbmsResponseDto.fail('Bạn không sở hữu ví này', 403) };
    }
    return { wallet };
  }

  private async ensureWallet(db: DbClient, userId: string) {
    const existing = await db.wallet.findUnique({ where: { userId } });
    if (existing) {
      return existing;
    }
    try {
      return await db.wallet.create({
        data: { userId, balance: new Prisma.Decimal(0) },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await db.wallet.findUnique({ where: { userId } });
        if (again) {
          return again;
        }
      }
      throw error;
    }
  }

  private async loadHistory(walletId: string, type?: WalletHistoryFilter) {
    const items = await this.prisma.walletTransaction.findMany({
      where: type ? { walletId, type } : { walletId },
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

  private mapWalletSummary(wallet: { id: string; userId: string; balance: Prisma.Decimal }) {
    return {
      walletId: wallet.id,
      userId: wallet.userId,
      walletBalance: toMoney(wallet.balance),
    };
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
