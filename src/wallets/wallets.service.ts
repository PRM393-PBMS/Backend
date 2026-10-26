import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, WalletBucket } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPickNumber, toMoney } from '../common/pbms-fields';
import { NotificationsService, formatVnd } from '../notifications/notifications.service';
import { CreateWalletAdjustmentDto } from './dto/create-wallet-adjustment.dto';

export class InsufficientWalletFundsError extends BadRequestException {
  constructor() {
    super('Số dư khả dụng không đủ');
    this.name = 'InsufficientWalletFundsError';
  }
}

const TOP_UP_MIN = 2000;
const TOP_UP_MAX = 10_000_000;
const TX_TAKE = 200;
/** Số lần thử lại khi số dư bị giao dịch khác đổi giữa lúc đọc và lúc trừ. */
const DEBIT_ATTEMPTS = 3;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Loại dòng sổ cái ví (cột wallet_transactions.type). */
export const WalletTxType = {
  TopUp: 'TOP_UP',
  Debit: 'DEBIT',
  Refund: 'REFUND',
  Adjustment: 'ADJUSTMENT',
} as const;

type WalletHistoryFilter = typeof WalletTxType.TopUp | typeof WalletTxType.Debit;
/** Nghiệp vụ chi từ ví (reference_type của dòng DEBIT). */
export type WalletSpendType = 'SubscriptionFee' | 'SubscriptionRenewal' | 'ParkingFee';
/** reference_type mà reference_id chính là payments.id. */
const PAYMENT_REFERENCE_TYPES = new Set(['WalletTopUp', 'SubscriptionFee', 'SubscriptionRenewal', 'ParkingFee']);
type DbClient = Prisma.TransactionClient | PrismaService;

type WalletBalances = {
  balance: Prisma.Decimal;
  bonusBalance: Prisma.Decimal;
  bonusExpiresAt: Date | null;
};

export interface WalletDebitResult {
  walletId: string;
  /** Tổng khả dụng (CASH + BONUS còn hạn) sau khi trừ. */
  balanceAfter: Prisma.Decimal;
  cashDebited: Prisma.Decimal;
  bonusDebited: Prisma.Decimal;
}

/** Ngăn BONUS chỉ dùng được khi chưa quá bonusExpiresAt. */
export function usableBonus(wallet: WalletBalances, now = new Date()): Prisma.Decimal {
  if (wallet.bonusExpiresAt && wallet.bonusExpiresAt <= now) {
    return new Prisma.Decimal(0);
  }
  return wallet.bonusBalance;
}

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
    @Optional() private readonly notifications?: NotificationsService,
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
    return this.listHistory(userId, walletId, WalletTxType.TopUp, 'Lấy lịch sử nạp ví thành công');
  }

  async listSpends(userId: string, walletId: string): Promise<PbmsResponseDto> {
    return this.listHistory(userId, walletId, WalletTxType.Debit, 'Lấy lịch sử chi ví thành công');
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
          walletBalance: toMoney(owned.wallet.balance.plus(usableBonus(owned.wallet))),
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

  /** Ví của user (tạo nếu chưa có) rồi trừ tiền, dùng cho các luồng chỉ biết userId. */
  async debitForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: Prisma.Decimal,
    referenceType: WalletSpendType,
    referenceId: string,
    description: string,
  ): Promise<WalletDebitResult> {
    const wallet = await this.ensureWallet(tx, userId);
    return this.debitInTransaction(tx, wallet.id, amount, referenceType, referenceId, description);
  }

  /**
   * Trừ ví trong giao dịch của caller: ngăn BONUS (còn hạn) trước, CASH sau.
   * Mỗi ngăn bị trừ ghi một dòng DEBIT riêng (amount âm) để hoàn tiền đúng ngăn.
   * Thiếu tiền ném InsufficientWalletFundsError (400) để caller huỷ cả giao dịch.
   */
  async debitInTransaction(
    tx: Prisma.TransactionClient,
    walletId: string,
    amount: Prisma.Decimal,
    referenceType: string,
    referenceId: string,
    description: string,
  ): Promise<WalletDebitResult> {
    if (amount.lte(0)) {
      throw new BadRequestException('Số tiền trừ ví phải lớn hơn 0');
    }
    for (let attempt = 0; attempt < DEBIT_ATTEMPTS; attempt++) {
      const wallet = await tx.wallet.findUnique({
        where: { id: walletId },
        select: { balance: true, bonusBalance: true, bonusExpiresAt: true },
      });
      if (!wallet) {
        throw new NotFoundException('Không tìm thấy ví');
      }
      const bonus = usableBonus(wallet);
      if (wallet.balance.plus(bonus).lt(amount)) {
        throw new InsufficientWalletFundsError();
      }
      const deductBonus = Prisma.Decimal.min(bonus, amount);
      const deductCash = amount.minus(deductBonus);
      // Chỉ trừ khi số dư chưa bị giao dịch khác đổi kể từ lúc đọc (khoá lạc quan).
      const updated = await tx.wallet.updateMany({
        where: { id: walletId, balance: wallet.balance, bonusBalance: wallet.bonusBalance },
        data: {
          balance: { decrement: deductCash },
          bonusBalance: { decrement: deductBonus },
        },
      });
      if (updated.count !== 1) {
        continue;
      }
      const cashAfter = wallet.balance.minus(deductCash);
      const bonusAfter = wallet.bonusBalance.minus(deductBonus);
      const paymentId = PAYMENT_REFERENCE_TYPES.has(referenceType) ? referenceId : null;
      const rows: Array<[WalletBucket, Prisma.Decimal, Prisma.Decimal]> = [
        [WalletBucket.BONUS, deductBonus, bonusAfter],
        [WalletBucket.CASH, deductCash, cashAfter],
      ];
      for (const [bucket, deducted, after] of rows) {
        if (deducted.lte(0)) continue;
        await tx.walletTransaction.create({
          data: {
            walletId,
            paymentId,
            type: WalletTxType.Debit,
            bucket,
            amount: deducted.negated(),
            balanceAfter: after,
            referenceType,
            referenceId,
            description,
          },
        });
      }
      return {
        walletId,
        balanceAfter: cashAfter.plus(usableBonus({ ...wallet, bonusBalance: bonusAfter })),
        cashDebited: deductCash,
        bonusDebited: deductBonus,
      };
    }
    throw new ConflictException('Ví đang được cập nhật, vui lòng thử lại');
  }

  /**
   * Hoàn tiền một nghiệp vụ đã trừ ví: cộng lại đúng ngăn đã trừ (BONUS về BONUS, CASH về CASH).
   * Gọi lại lần nữa không hoàn thêm. Trả null nếu nghiệp vụ không trừ ví.
   */
  async refundTransaction(
    tx: Prisma.TransactionClient,
    referenceType: string,
    referenceId: string,
    description = 'Hoàn tiền về ví',
  ): Promise<{ walletId: string; cashRefunded: Prisma.Decimal; bonusRefunded: Prisma.Decimal } | null> {
    const debits = await tx.walletTransaction.findMany({
      where: { referenceType, referenceId, type: WalletTxType.Debit },
    });
    if (debits.length === 0) {
      return null;
    }
    const walletId = debits[0].walletId;
    // Khoá ví để hai lần hoàn đồng thời không cùng lọt qua bước kiểm tra bên dưới.
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${walletId}::uuid FOR UPDATE`;
    const refunded = await tx.walletTransaction.findFirst({
      where: { referenceType, referenceId, type: WalletTxType.Refund },
    });
    if (refunded) {
      return { walletId, cashRefunded: new Prisma.Decimal(0), bonusRefunded: new Prisma.Decimal(0) };
    }
    let cashRefunded = new Prisma.Decimal(0);
    let bonusRefunded = new Prisma.Decimal(0);
    for (const debit of debits) {
      const amount = debit.amount.abs();
      const isBonus = debit.bucket === WalletBucket.BONUS;
      const wallet = await tx.wallet.update({
        where: { id: debit.walletId },
        data: isBonus ? { bonusBalance: { increment: amount } } : { balance: { increment: amount } },
        select: { balance: true, bonusBalance: true },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: debit.walletId,
          type: WalletTxType.Refund,
          bucket: debit.bucket,
          amount,
          balanceAfter: isBonus ? wallet.bonusBalance : wallet.balance,
          referenceType,
          referenceId,
          description,
        },
      });
      if (isBonus) {
        bonusRefunded = bonusRefunded.plus(amount);
      } else {
        cashRefunded = cashRefunded.plus(amount);
      }
    }
    return { walletId, cashRefunded, bonusRefunded };
  }

  /**
   * Admin/Manager cộng hoặc thu hồi ngăn BONUS. Ngăn CASH không bao giờ bị đụng tới.
   * Mỗi lần điều chỉnh có một dòng ADJUSTMENT trong sổ cái và một bản ghi WalletAdjustmentLog.
   */
  async adjustBonusBalance(
    walletId: string,
    adminId: string,
    dto: CreateWalletAdjustmentDto,
  ): Promise<PbmsResponseDto> {
    if (isEmptyGuid(adminId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    if (isEmptyGuid(walletId) || !UUID_RE.test(walletId)) {
      return PbmsResponseDto.fail('Vui lòng nhập WalletId hợp lệ');
    }
    const amount = new Prisma.Decimal(dto.amount);
    const note = dto.note.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${walletId}::uuid FOR UPDATE`;
      const wallet = await tx.wallet.findUnique({
        where: { id: walletId },
        select: { id: true, userId: true, balance: true, bonusBalance: true, bonusExpiresAt: true },
      });
      if (!wallet) {
        return PbmsResponseDto.fail('Không tìm thấy ví', 404);
      }
      if (wallet.bonusBalance.plus(amount).lt(0)) {
        return PbmsResponseDto.fail('Số dư khuyến mãi không đủ để thu hồi');
      }
      const bonusExpiresAt = dto.expiryDays
        ? new Date(Date.now() + dto.expiryDays * 24 * 60 * 60 * 1000)
        : wallet.bonusExpiresAt;
      const updated = await tx.wallet.update({
        where: { id: walletId },
        data: { bonusBalance: { increment: amount }, bonusExpiresAt },
      });
      const log = await tx.walletAdjustmentLog.create({
        data: { walletId, adminId, amount, reasonType: dto.reasonType, note },
      });
      await tx.walletTransaction.create({
        data: {
          walletId,
          type: WalletTxType.Adjustment,
          bucket: WalletBucket.BONUS,
          amount,
          balanceAfter: updated.bonusBalance,
          referenceType: 'Adjustment',
          referenceId: log.id,
          description: note,
        },
      });
      return { wallet: updated, log };
    });
    if (result instanceof PbmsResponseDto) {
      return result;
    }
    const credited = amount.gt(0);
    await this.notifications?.notify(result.wallet.userId, {
      title: credited ? 'Ví được cộng tiền khuyến mãi' : 'Điều chỉnh tiền khuyến mãi',
      message: `${credited ? 'Cộng' : 'Thu hồi'} ${formatVnd(toMoney(amount.abs()))} ở ngăn khuyến mãi. Lý do: ${note}`,
      type: 'wallet',
      metadata: { walletId, adjustmentId: result.log.id, reasonType: dto.reasonType },
    });
    return PbmsResponseDto.ok(
      'Điều chỉnh ví khuyến mãi thành công',
      {
        adjustmentId: result.log.id,
        reasonType: result.log.reasonType,
        amount: toMoney(amount),
        note,
        ...this.mapWalletSummary(result.wallet),
      },
      201,
    );
  }

  async creditFromPayment(
    tx: Prisma.TransactionClient,
    payment: { id: string; userId: string | null; amount: Prisma.Decimal },
  ): Promise<void> {
    if (!payment.userId) {
      throw new Error(`Không thể cộng ví cho thanh toán ${payment.id}: thiếu UserId.`);
    }
    const existing = await tx.walletTransaction.findUnique({
      where: { paymentId_bucket: { paymentId: payment.id, bucket: WalletBucket.CASH } },
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
        type: WalletTxType.TopUp,
        bucket: WalletBucket.CASH,
        amount: payment.amount,
        balanceAfter: updated.balance,
        referenceType: 'WalletTopUp',
        referenceId: payment.id,
        description: 'Nạp ví qua PayOS',
      },
    });
  }

  /**
   * Hoàn một khoản đã trả qua cổng ngoài (vd. tiền cọc PayOS) vào ngăn CASH của ví.
   * Gọi lại cho cùng thanh toán không cộng thêm. Trả về true nếu lần này đã cộng tiền.
   */
  async creditRefund(
    tx: Prisma.TransactionClient,
    payment: { id: string; userId: string | null; amount: Prisma.Decimal },
    referenceType: string,
    description: string,
  ): Promise<boolean> {
    if (!payment.userId) {
      throw new Error(`Không thể hoàn tiền cho thanh toán ${payment.id}: thiếu UserId.`);
    }
    const existing = await tx.walletTransaction.findUnique({
      where: { paymentId_bucket: { paymentId: payment.id, bucket: WalletBucket.CASH } },
    });
    if (existing) {
      return false;
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
        type: WalletTxType.Refund,
        bucket: WalletBucket.CASH,
        amount: payment.amount,
        balanceAfter: updated.balance,
        referenceType,
        referenceId: payment.id,
        description,
      },
    });
    return true;
  }

  async getBalanceForUser(userId: string): Promise<{
    walletId: string | null;
    walletBalance: number;
  }> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, balance: true, bonusBalance: true, bonusExpiresAt: true },
    });
    return {
      walletId: wallet?.id ?? null,
      walletBalance: wallet ? toMoney(wallet.balance.plus(usableBonus(wallet))) : 0,
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
  ): Promise<
    | { wallet: WalletBalances & { id: string; userId: string }; error?: never }
    | { wallet?: never; error: PbmsResponseDto }
  > {
    if (isEmptyGuid(userId)) {
      return { error: PbmsResponseDto.fail('Vui lòng đăng nhập', 401) };
    }
    if (isEmptyGuid(walletId) || !UUID_RE.test(walletId)) {
      return { error: PbmsResponseDto.fail('Vui lòng nhập WalletId hợp lệ') };
    }
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { id: true, userId: true, balance: true, bonusBalance: true, bonusExpiresAt: true },
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
                vehicle: { select: { licensePlate: true } },
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

  private mapWalletSummary(wallet: WalletBalances & { id: string; userId: string }) {
    const bonus = usableBonus(wallet);
    return {
      walletId: wallet.id,
      userId: wallet.userId,
      /** Tổng khả dụng = tiền nạp + khuyến mãi còn hạn. */
      walletBalance: toMoney(wallet.balance.plus(bonus)),
      cashBalance: toMoney(wallet.balance),
      bonusBalance: toMoney(bonus),
      bonusExpiresAt: wallet.bonusExpiresAt,
    };
  }

  private mapTransaction(item: {
    id: string;
    paymentId: string | null;
    type: string;
    bucket: WalletBucket;
    amount: Prisma.Decimal;
    balanceAfter: Prisma.Decimal;
    referenceType: string | null;
    referenceId: string | null;
    description: string | null;
    createdAt: Date;
    payment?: {
      id: string;
      subscriptionId: string | null;
      paymentMethod: string;
      paymentType: string | null;
      transactionReference: string | null;
      subscription: {
        id: string;
        vehicle: { licensePlate: string } | null;
        package: { packageName: string } | null;
      } | null;
    } | null;
  }) {
    const signedAmount = toMoney(item.amount);
    const isCredit = signedAmount > 0;
    const packageName = item.payment?.subscription?.package?.packageName ?? null;
    const licensePlate = item.payment?.subscription?.vehicle?.licensePlate ?? null;
    const subscriptionId = item.payment?.subscriptionId ?? item.payment?.subscription?.id ?? null;
    return {
      walletTransactionId: item.id,
      direction: isCredit ? 'Credit' : 'Debit',
      type: item.type,
      bucket: item.bucket,
      referenceType: item.referenceType,
      referenceId: item.referenceId,
      amount: signedAmount,
      absoluteAmount: Math.abs(signedAmount),
      balanceAfter: toMoney(item.balanceAfter),
      createdAt: item.createdAt,
      paymentId: item.paymentId ?? item.payment?.id ?? null,
      subscriptionId,
      paymentMethod: item.payment?.paymentMethod ?? (item.type === WalletTxType.TopUp ? 'PayOS' : 'Wallet'),
      paymentType: item.payment?.paymentType ?? item.referenceType,
      orderCode: item.payment?.transactionReference ?? null,
      packageName,
      licensePlate,
      description: item.description ?? this.legacyDescription(item.type, item.referenceType, packageName, licensePlate),
    };
  }

  /** Mô tả cho dòng sổ cái cũ (trước khi có cột description). */
  private legacyDescription(
    type: string,
    referenceType: string | null,
    packageName: string | null,
    licensePlate: string | null,
  ): string {
    if (type === WalletTxType.TopUp) return 'Nạp ví qua PayOS';
    if (referenceType === 'ParkingFee') return 'Thanh toán phí gửi xe bằng ví';
    return packageName
      ? `Mua gói tháng ${packageName}${licensePlate ? ` — ${licensePlate}` : ''}`
      : 'Thanh toán gói tháng bằng ví';
  }
}
