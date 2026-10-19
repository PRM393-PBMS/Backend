import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService, formatVnd } from './notifications.service';

describe('NotificationsService', () => {
  const userId = '0b6f3c6e-6a64-4c1c-9d5a-2b9c7f3f1a11';
  const otherId = '7d1f0a2b-3c4d-4e5f-8a9b-0c1d2e3f4a55';
  const notifId = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c11';

  let service: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    vehicle: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          {
            id: notifId,
            userId,
            title: 'Nạp ví thành công',
            message: 'Đã cộng 50.000 đ vào ví PBMS.',
            type: 'wallet',
            isRead: false,
            metadata: null,
            createdAt: new Date('2026-10-19T03:00:00Z'),
          },
        ]),
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(3),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      vehicle: { findUnique: jest.fn().mockResolvedValue({ userId }) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('trả danh sách theo đúng dạng app đang đọc (items, unreadCount, total)', async () => {
    const res = await service.getMine(userId);
    expect(res.isSuccess).toBe(true);
    expect(res.result).toEqual({
      items: [expect.objectContaining({ id: notifId, isRead: false, createdAt: '2026-10-19T03:00:00.000Z' })],
      unreadCount: 1,
      total: 3,
    });
    expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({ userId });
  });

  it('chỉ đánh dấu / xoá thông báo của chính người dùng', async () => {
    await service.markRead(otherId, notifId);
    expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({ id: notifId, userId: otherId });

    const res = await service.remove(otherId, notifId);
    expect(res.statusCode).toBe(404);
    expect(prisma.notification.deleteMany.mock.calls[0][0].where).toEqual({ id: notifId, userId: otherId });
  });

  it('báo cho chủ xe theo biển số đã chuẩn hoá', async () => {
    await service.notifyPlateOwner('51h-123.45', { title: 'Xe đã vào bãi', message: 'x', type: 'parking' });
    expect(prisma.vehicle.findUnique.mock.calls[0][0].where).toEqual({ licensePlate: '51H12345' });
    expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({ userId, type: 'parking' });
  });

  it('xe vãng lai không có chủ thì không ghi gì', async () => {
    prisma.vehicle.findUnique.mockResolvedValue(null);
    await service.notifyPlateOwner('51H99999', { title: 't', message: 'm', type: 'parking' });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('lỗi ghi thông báo không làm hỏng luồng chính', async () => {
    prisma.notification.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.notify(userId, { title: 't', message: 'm', type: 'system' }),
    ).resolves.toBeUndefined();
  });

  it('định dạng tiền kiểu Việt Nam', () => {
    expect(formatVnd(120000)).toBe('120.000 đ');
  });
});
