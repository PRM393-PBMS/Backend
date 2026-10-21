import { HashingService } from '../auth/services/hashing.service';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { ContractsService } from '../subscriptions/contracts.service';
import { MonthlySubscriptionsService } from '../subscriptions/monthly-subscriptions.service';
import { VehicleChangeRequestsService } from '../subscriptions/vehicle-change-requests.service';
import { WalletsService } from '../wallets/wallets.service';
import { NotificationsService } from './notifications.service';

describe('Thông báo cho khách từ thao tác back-office và cron', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  let notifications: { notify: jest.Mock };

  beforeEach(() => {
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  });

  const asNotifications = () => notifications as unknown as NotificationsService;

  it('từ chối đổi biển số: báo chủ vé kèm lý do', async () => {
    const record = {
      id: 'req-1',
      subscriptionId: 'sub-1',
      oldLicensePlate: '51A12345',
      newLicensePlate: '51B67890',
      reason: null,
      rejectionReason: null,
      status: 'Pending',
      createdAt: new Date(),
      processedAt: null,
      handledByStaffId: null,
      subscription: { userId, user: { fullName: 'A' }, package: { packageName: 'P' } },
      handledByStaff: null,
    };
    const prisma = {
      vehicleChangeRequest: {
        findUnique: jest.fn().mockResolvedValue(record),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new VehicleChangeRequestsService(
      prisma as unknown as PrismaService,
      {} as HashingService,
      asNotifications(),
    );

    const res = await service.reject('req-1', 'staff-1', { reason: 'Giấy tờ không khớp' });

    expect(res.isSuccess).toBe(true);
    expect(notifications.notify).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        type: 'subscription',
        message: expect.stringContaining('Giấy tờ không khớp'),
        metadata: expect.objectContaining({ rejectionReason: 'Giấy tờ không khớp', status: 'Rejected' }),
      }),
    );
  });

  it('cron NoShow: báo từng khách có đặt chỗ quá hạn', async () => {
    const prisma = {
      reservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', userId, expectedEntryTime: new Date(Date.now() - 40 * 60e3), vehicle: { licensePlate: '51A12345' } },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new ReservationsService(
      prisma as unknown as PrismaService,
      {} as PayosService,
      asNotifications(),
    );

    await service.processOverdueReservations();

    expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'NoShow' } });
    expect(notifications.notify).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ type: 'reservation', metadata: { reservationId: 'r1', status: 'NoShow' } }),
    );
  });

  it('cron hết hạn vé tháng: Active quá endDate chuyển Expired và báo khách', async () => {
    const prisma = {
      monthlySubscription: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sub-1', userId }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new MonthlySubscriptionsService(
      prisma as unknown as PrismaService,
      {} as PayosService,
      {} as WalletsService,
      {} as ContractsService,
      {} as HashingService,
      asNotifications(),
    );

    await service.expireOverdueSubscriptions();

    const where = prisma.monthlySubscription.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('Active');
    expect(where.endDate.lt).toBeInstanceOf(Date);
    expect(prisma.monthlySubscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-1'] }, status: 'Active' },
      data: { status: 'Expired' },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ type: 'subscription', metadata: { subscriptionId: 'sub-1', status: 'Expired' } }),
    );
  });
});
