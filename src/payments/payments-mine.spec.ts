import { Prisma } from '@prisma/client';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PaymentsService } from './payments.service';

describe('Lịch sử thanh toán của tôi', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  let prisma: { payment: { count: jest.Mock; findMany: jest.Mock } };
  let service: PaymentsService;

  beforeEach(() => {
    prisma = {
      payment: {
        count: jest.fn().mockResolvedValue(45),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pay-1',
            userId,
            sessionId: null,
            reservationId: null,
            subscriptionId: 'sub-1',
            amount: new Prisma.Decimal(300000),
            paymentMethod: 'PayOS',
            paymentType: 'SubscriptionFee',
            paymentTime: new Date('2026-10-20T08:00:00Z'),
            paymentStatus: 'Success',
            transactionReference: '1727',
            session: null,
            reservation: null,
            subscription: { vehicle: { licensePlate: '59A12345' }, package: { packageName: 'Gói tháng xe máy' } },
          },
        ]),
      },
    };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      {} as WalletsService,
      {} as PayosService,
    );
  });

  it('chỉ lấy thanh toán của user trong token, mới nhất trước, có phân trang', async () => {
    const res = await service.getMine(userId, '2', '20');
    const query = prisma.payment.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ userId });
    expect(query.orderBy).toEqual([{ paymentTime: 'desc' }, { id: 'desc' }]);
    expect(query.skip).toBe(20);
    expect(query.take).toBe(20);
    expect(res.result).toEqual(
      expect.objectContaining({ page: 2, pageSize: 20, total: 45, hasMore: true }),
    );
    expect((res.result as { items: unknown[] }).items[0]).toEqual(
      expect.objectContaining({
        paymentId: 'pay-1',
        amount: 300000,
        paymentTypeLabel: 'Vé tháng',
        licensePlate: '59A12345',
        packageName: 'Gói tháng xe máy',
      }),
    );
  });

  it('pageSize vượt trần thì giới hạn 50; lọc theo trạng thái', async () => {
    await service.getMine(userId, undefined, '999', 'success');
    const query = prisma.payment.findMany.mock.calls[0][0];
    expect(query.take).toBe(50);
    expect(query.where).toEqual({ userId, paymentStatus: 'Success' });
  });

  it('trạng thái lọc lạ: 400; chưa đăng nhập: 401', async () => {
    expect((await service.getMine(userId, '1', '20', 'Paid')).statusCode).toBe(400);
    expect((await service.getMine('', '1', '20')).statusCode).toBe(401);
  });
});
