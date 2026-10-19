import { Test, TestingModule } from '@nestjs/testing';
import { HashingService } from '../auth/services/hashing.service';
import { FilesService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService.deleteAccount', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  let service: UsersService;
  let hashing: { compare: jest.Mock; hash: jest.Mock };
  let counts: number[];
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    parkingSession: { count: jest.Mock };
    monthlySubscription: { count: jest.Mock };
    reservation: { count: jest.Mock };
    payment: { count: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    notification: { deleteMany: jest.Mock };
    entryPass: { updateMany: jest.Mock };
    vehicle: { deleteMany: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    counts = [0, 0, 0, 0];
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId, passwordHash: 'h', wallet: { balance: 0 } }),
        update: jest.fn().mockResolvedValue({}),
      },
      parkingSession: { count: jest.fn(() => Promise.resolve(counts[0])) },
      monthlySubscription: { count: jest.fn(() => Promise.resolve(counts[1])) },
      reservation: { count: jest.fn(() => Promise.resolve(counts[2])) },
      payment: { count: jest.fn(() => Promise.resolve(counts[3])) },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      entryPass: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      vehicle: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    hashing = { compare: jest.fn().mockResolvedValue(true), hash: jest.fn().mockResolvedValue('random-hash') };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: hashing },
        { provide: FilesService, useValue: {} },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('ẩn danh hoá hồ sơ, khoá đăng nhập, thu hồi phiên', async () => {
    const res = await service.deleteAccount(userId, { password: 'dung' });
    expect(res.isSuccess).toBe(true);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      phoneNumber: null,
      avatarUrl: null,
      fullName: 'Tài khoản đã xoá',
      isActive: false,
      status: 'Deleted',
      passwordHash: 'random-hash',
    });
    expect(data.email).toMatch(/@deleted\.pbms\.invalid$/);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    // Chỉ xoá xe chưa có lịch sử.
    expect(prisma.vehicle.deleteMany.mock.calls[0][0].where).toMatchObject({
      userId,
      parkingSessions: { none: {} },
    });
  });

  it('sai mật khẩu thì không xoá', async () => {
    hashing.compare.mockResolvedValue(false);
    const res = await service.deleteAccount(userId, { password: 'sai' });
    expect(res.message).toBe('Mật khẩu không đúng');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('còn xe trong bãi / vé tháng thì báo rõ và không xoá', async () => {
    counts = [1, 1, 0, 0];
    const res = await service.deleteAccount(userId, { password: 'dung' });
    expect(res.statusCode).toBe(409);
    expect(res.message).toContain('xe đang gửi trong bãi');
    expect(res.message).toContain('vé tháng');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('còn tiền trong ví thì không xoá', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: userId, passwordHash: 'h', wallet: { balance: 50000 } });
    const res = await service.deleteAccount(userId, { password: 'dung' });
    expect(res.statusCode).toBe(409);
    expect(res.message).toContain('số dư ví');
  });
});
