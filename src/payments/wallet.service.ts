import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { errorMessage, pbmsPickNumber, toMoney } from '../common/pbms-fields';

export const WALLET_TOP_UP_MIN = 10_000;
export const WALLET_TOP_UP_MAX = 5_000_000;

type Tx = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
  ) {}

  private async ensureWallet(userId: string, tx: Tx | PrismaService = this.prisma) {
    return tx.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const wallet = await this.ensureWallet(userId);
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const pending = await this.prisma.payment.findMany({
      where: { userId, paymentType: 'WalletTopUp', paymentStatus: 'Pending' },
      orderBy: { paymentTime: 'desc' },
      take: 5,
    });
    return PbmsResponseDto.ok('Lấy thông tin ví thành công', {
      walletId: wallet.id,
      balance: toMoney(wallet.balance),
      transactions: transactions.map((t) => ({
        transactionId: t.id,
        type: t.type,
        amount: toMoney(t.amount),
        balanceAfter: toMoney(t.balanceAfter),
        paymentId: t.paymentId,
        description: t.description,
        createdAt: t.createdAt,
      })),
      pendingTopUps: pending.map((p) => ({
        paymentId: p.id,
        amount: toMoney(p.amount),
        orderCode: p.transactionReference,
        createdAt: p.paymentTime,
      })),
      topUpMin: WALLET_TOP_UP_MIN,
      topUpMax: WALLET_TOP_UP_MAX,
    });
  }

  /** Tạo yêu cầu nạp ví qua PayOS (QR ngân hàng, thẻ nội địa/quốc tế trên trang PayOS). */
  async createTopUp(userId: string, dto: object): Promise<PbmsResponseDto> {
    const amount = Math.round(pbmsPickNumber(dto, 'amount', 'Amount') ?? 0);
    if (amount < WALLET_TOP_UP_MIN || amount > WALLET_TOP_UP_MAX) {
      return PbmsResponseDto.fail(
        `Số tiền nạp phải từ ${WALLET_TOP_UP_MIN.toLocaleString('vi-VN')}đ đến ${WALLET_TOP_UP_MAX.toLocaleString('vi-VN')}đ`,
      );
    }
    await this.ensureWallet(userId);
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        amount: new Prisma.Decimal(amount),
        paymentMethod: 'PayOS',
        paymentType: 'WalletTopUp',
        paymentTime: new Date(),
        paymentStatus: 'Pending',
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
        'Đã tạo yêu cầu nạp ví',
        {
          paymentId: payment.id,
          amount,
          paymentUrl: link.paymentUrl,
          paymentLinkId: link.paymentLinkId,
          orderCode: link.orderCode,
        },
        201,
      );
    } catch (error: unknown) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { paymentStatus: 'Failed' } });
      return PbmsResponseDto.fail(`Không thể tạo liên kết thanh toán: ${errorMessage(error)}`, 502);
    }
  }

  /** Cộng tiền vào ví cho một thanh toán nạp ví đã thành công (gọi đúng một lần). */
  async creditTopUp(payment: { id: string; userId: string | null; amount: Prisma.Decimal }): Promise<void> {
    if (!payment.userId) {
      throw new Error(`Thanh toán nạp ví ${payment.id} thiếu UserId.`);
    }
    const userId = payment.userId;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.walletTransaction.findUnique({ where: { paymentId: payment.id } });
      if (existing) {
        return;
      }
      const wallet = await this.ensureWallet(userId, tx);
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: payment.amount } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'TopUp',
          amount: payment.amount,
          balanceAfter: updated.balance,
          paymentId: payment.id,
          description: 'Nạp tiền qua PayOS',
        },
      });
    });
  }

  /**
   * Trừ ví trong cùng giao dịch với nghiệp vụ gọi tới.
   * Trả `false` nếu số dư không đủ (không trừ gì).
   */
  async debit(
    tx: Tx,
    userId: string,
    amount: number,
    paymentId: string,
    description: string,
  ): Promise<boolean> {
    const wallet = await this.ensureWallet(userId, tx);
    const value = new Prisma.Decimal(amount);
    // Trừ có điều kiện để hai yêu cầu đồng thời không làm số dư âm.
    const result = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: value } },
      data: { balance: { decrement: value } },
    });
    if (result.count !== 1) {
      return false;
    }
    const updated = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'Payment',
        amount: value,
        balanceAfter: updated.balance,
        paymentId,
        description,
      },
    });
    return true;
  }

  async balanceOf(userId: string): Promise<number> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return wallet ? toMoney(wallet.balance) : 0;
  }
}
