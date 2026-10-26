import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PaymentsService } from './payments.service';

describe('Xác nhận tiền cọc đặt chỗ', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const deposit = {
    id: 'pay-1',
    userId,
    amount: new Prisma.Decimal(30000),
    paymentStatus: 'Success',
    paymentType: 'Deposit',
    reservationId: 'r1',
  };
  let prisma: {
    payment: { findUnique: jest.Mock; update: jest.Mock };
    reservation: { findUnique: jest.Mock; update: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let wallets: { creditRefund: jest.Mock };
  let notifications: { notify: jest.Mock };
  let apply: (paymentId: string) => Promise<void>;

  beforeEach(() => {
    prisma = {
      payment: { findUnique: jest.fn().mockResolvedValue(deposit), update: jest.fn().mockResolvedValue({}) },
      reservation: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      vehicle: { findUnique: jest.fn().mockResolvedValue({ licensePlate: '51A12345' }) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    wallets = { creditRefund: jest.fn().mockResolvedValue(true) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      wallets as unknown as WalletsService,
      {} as PayosService,
      notifications as unknown as NotificationsService,
    );
    apply = (id) => (service as unknown as { applyPaidPayment(id: string): Promise<void> }).applyPaidPayment(id);
  });

  it('đơn đang chờ: chuyển sang Confirmed', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ id: 'r1', status: 'Pending', vehicleId: 'v1' });
    await apply('pay-1');
    expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'Confirmed' } });
    expect(wallets.creditRefund).not.toHaveBeenCalled();
  });

  it('đơn đã huỷ trước khi cọc về: không mở lại đơn, hoàn cọc vào ví', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ id: 'r1', status: 'Cancelled', vehicleId: 'v1' });
    await apply('pay-1');
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(wallets.creditRefund).toHaveBeenCalledWith(prisma, deposit, 'Deposit', expect.stringContaining('51A12345'));
    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay-1' }, data: { paymentStatus: 'Refunded' } });
    expect(notifications.notify).toHaveBeenCalledWith(userId, expect.objectContaining({ title: 'Đã hoàn tiền cọc' }));
  });
});
