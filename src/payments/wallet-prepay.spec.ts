import { Prisma } from '@prisma/client';
import { exitPassPayload, generateExitPassCode, mapExitPass } from '../common/exit-pass';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { WalletService } from './wallet.service';

const topUp = {
  id: 'pay-top',
  userId: 'user-1',
  amount: new Prisma.Decimal(100000),
  paymentMethod: 'PayOS',
  paymentType: 'WalletTopUp',
  paymentStatus: 'Pending',
  transactionReference: '1792216717',
  sessionId: null,
  reservationId: null,
  subscriptionId: null,
};

function setup(remoteStatus: string, amountPaid = 100000) {
  const prisma = {
    payment: {
      findFirst: jest.fn().mockResolvedValue(topUp),
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(topUp)
        .mockResolvedValue({ ...topUp, paymentStatus: 'Success' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
  };
  const payos = {
    getPaymentStatus: jest.fn().mockResolvedValue({ status: remoteStatus, amount: 100000, amountPaid }),
  };
  const wallet = { creditTopUp: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    payos as unknown as PayosService,
    wallet as unknown as WalletService,
  );
  return { service, prisma, payos, wallet };
}

describe('Nạp ví qua PayOS', () => {
  it('không tin body webhook: hỏi lại PayOS, chưa PAID thì không cộng tiền', async () => {
    const { service, prisma, payos, wallet } = setup('PENDING');
    // Webhook giả mạo báo thành công.
    await service.handleWebhook({ code: '00', data: { orderCode: '1792216717' } });

    expect(payos.getPaymentStatus).toHaveBeenCalledWith('1792216717');
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('PayOS xác nhận PAID đủ tiền thì cộng ví đúng một lần', async () => {
    const { service, prisma, wallet } = setup('PAID');
    const status = await service.syncPayosPayment('pay-top');

    expect(status).toBe('Success');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pay-top', paymentStatus: 'Pending' } }),
    );
    expect(wallet.creditTopUp).toHaveBeenCalledTimes(1);
  });

  it('thanh toán thiếu tiền không được ghi nhận', async () => {
    const { service, wallet } = setup('PAID', 50000);
    expect(await service.syncPayosPayment('pay-top')).toBe('Pending');
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('webhook và nút kiểm tra chạy song song: bên thua không cộng tiền lần hai', async () => {
    const { service, prisma, wallet } = setup('PAID');
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });
    await service.syncPayosPayment('pay-top');
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });
});

describe('Trừ ví', () => {
  it('số dư không đủ thì không trừ và không ghi giao dịch', async () => {
    const tx = {
      wallet: {
        upsert: jest.fn().mockResolvedValue({ id: 'w1', balance: new Prisma.Decimal(5000) }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
      },
      walletTransaction: { create: jest.fn() },
    };
    const service = new WalletService({} as PrismaService, {} as PayosService);
    const ok = await service.debit(tx as unknown as Prisma.TransactionClient, 'user-1', 20000, 'pay-1', 'Phí');

    expect(ok).toBe(false);
    expect(tx.wallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'w1', balance: { gte: new Prisma.Decimal(20000) } },
      }),
    );
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });
});

describe('Mã ra cổng', () => {
  it('mã 6 ký tự, không có ký tự dễ nhầm', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateExitPassCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it('chỉ có hiệu lực khi phiên còn Active', async () => {
    const base = { id: '11111111-2222-3333-4444-555555555555', prepaidAt: new Date(), exitPassCode: 'ABC234' };
    const pass = await mapExitPass({ ...base, status: 'Active' });
    expect(pass?.qrPayload).toBe(exitPassPayload(base.id, 'ABC234'));
    expect(pass?.qrPayload).toContain(base.id);
    expect(await mapExitPass({ ...base, status: 'Completed' })).toBeNull();
  });
});
