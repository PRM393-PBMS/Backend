import { Prisma } from '@prisma/client';
import { PayosService } from '../integrations/payos-files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { ReservationsService } from './reservations.service';

describe('ReservationsService: hạn mức vãng lai và huỷ có hoàn cọc', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  let prisma: {
    vehicleType: { findMany: jest.Mock };
    floor: { findMany: jest.Mock };
    reservation: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock };
    payment: { findMany: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let wallets: { creditRefund: jest.Mock };
  let payos: { cancelPaymentLink: jest.Mock };
  let notifications: { notify: jest.Mock };
  let service: ReservationsService;

  const paidDeposit = { id: 'pay-1', userId, amount: new Prisma.Decimal(30000), paymentStatus: 'Success' };

  beforeEach(() => {
    prisma = {
      vehicleType: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'car-a', typeName: 'Ô tô' },
          { id: 'car-b', typeName: 'ô tô' },
          { id: 'bike', typeName: 'Xe máy' },
        ]),
      },
      floor: { findMany: jest.fn() },
      reservation: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    wallets = { creditRefund: jest.fn().mockResolvedValue(true) };
    payos = { cancelPaymentLink: jest.fn().mockResolvedValue(undefined) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new ReservationsService(
      prisma as unknown as PrismaService,
      payos as unknown as PayosService,
      notifications as unknown as NotificationsService,
      wallets as unknown as WalletsService,
    );
  });

  describe('sức chứa vãng lai', () => {
    it('tầng ô tô chưa sinh ô riêng vẫn tính theo sức chứa của tầng', async () => {
      prisma.floor.findMany.mockResolvedValue([
        { totalCapacity: 40, dedicatedVehicleTypeId: 'car-a', _count: { parkingSlots: 0 } },
        { totalCapacity: 200, dedicatedVehicleTypeId: 'bike', _count: { parkingSlots: 0 } },
      ]);
      const r = await service.walkInCapacity('car-a', 'Ô tô');
      expect(r.capacity).toBe(40);
    });

    it('tầng có ô riêng thì đếm ô; gộp các loại xe trùng tên "Ô tô"', async () => {
      prisma.floor.findMany.mockResolvedValue([
        { totalCapacity: 50, dedicatedVehicleTypeId: 'car-b', _count: { parkingSlots: 12 } },
      ]);
      const r = await service.walkInCapacity('car-a', 'Ô tô');
      expect(r.capacity).toBe(12);
      expect(r.typeIds.sort()).toEqual(['car-a', 'car-b']);
      const where = prisma.floor.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ isResident: false });
    });

    it('không có chỗ vãng lai nào thì sức chứa 0', async () => {
      prisma.floor.findMany.mockResolvedValue([
        { totalCapacity: 200, dedicatedVehicleTypeId: 'bike', _count: { parkingSlots: 0 } },
      ]);
      expect((await service.walkInCapacity('car-a', 'Ô tô')).capacity).toBe(0);
    });
  });

  describe('huỷ đặt chỗ', () => {
    const reservation = (status: string, minutesFromNow: number) => ({
      id: 'r1',
      userId,
      status,
      expectedEntryTime: new Date(Date.now() + minutesFromNow * 60_000),
      vehicle: { licensePlate: '51A12345' },
    });

    it('đã trả cọc, huỷ trước giờ hẹn: hoàn cọc vào ví và đánh dấu Refunded', async () => {
      prisma.reservation.findUnique.mockResolvedValue(reservation('Confirmed', 60));
      prisma.payment.findFirst.mockResolvedValue(paidDeposit);

      const res = await service.cancel('r1', userId);

      expect(res.isSuccess).toBe(true);
      expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'Cancelled' } });
      expect(wallets.creditRefund).toHaveBeenCalledWith(prisma, paidDeposit, 'Deposit', expect.stringContaining('51A12345'));
      expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay-1' }, data: { paymentStatus: 'Refunded' } });
      expect(res.result).toEqual(expect.objectContaining({ refundedAmount: 30000 }));
      expect(notifications.notify).toHaveBeenCalledWith(userId, expect.objectContaining({ type: 'wallet' }));
    });

    it('huỷ sau giờ hẹn: không hoàn cọc', async () => {
      prisma.reservation.findUnique.mockResolvedValue(reservation('Confirmed', -10));
      prisma.payment.findFirst.mockResolvedValue(paidDeposit);

      const res = await service.cancel('r1', userId);

      expect(wallets.creditRefund).not.toHaveBeenCalled();
      expect(res.result).toEqual(expect.objectContaining({ refundedAmount: 0 }));
      expect(res.message).toContain('không được hoàn');
    });

    it('chưa trả cọc: đóng link PayOS đang chờ, không hoàn gì', async () => {
      prisma.reservation.findUnique.mockResolvedValue(reservation('Pending', 60));
      prisma.payment.findMany.mockResolvedValue([{ id: 'pay-0', transactionReference: '1727' }]);

      await service.cancel('r1', userId);

      expect(payos.cancelPaymentLink).toHaveBeenCalledWith('1727');
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-0', paymentStatus: 'Pending' },
        data: { paymentStatus: 'Failed' },
      });
      expect(wallets.creditRefund).not.toHaveBeenCalled();
    });

    it('không huỷ lại đơn đã kết thúc, không huỷ đơn của người khác', async () => {
      prisma.reservation.findUnique.mockResolvedValue(reservation('Cancelled', 60));
      expect((await service.cancel('r1', userId)).statusCode).toBe(400);
      prisma.reservation.findUnique.mockResolvedValue(reservation('Confirmed', 60));
      expect((await service.cancel('r1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).statusCode).toBe(403);
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });
  });
});
