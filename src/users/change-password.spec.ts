import { Test, TestingModule } from '@nestjs/testing';
import { HashingService } from '../auth/services/hashing.service';
import { FilesService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService.changePassword', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let hashing: { compare: jest.Mock; hash: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId, passwordHash: 'old-hash' }),
        update: jest.fn().mockResolvedValue({}),
      },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    hashing = {
      compare: jest.fn().mockResolvedValue(true),
      hash: jest.fn().mockResolvedValue('new-hash'),
    };
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

  it('đổi mật khẩu khi nhập đúng mật khẩu hiện tại và thu hồi phiên cũ', async () => {
    const res = await service.changePassword(userId, {
      currentPassword: 'cu123456',
      newPassword: 'moi123456',
    });

    expect(res.isSuccess).toBe(true);
    expect(hashing.compare).toHaveBeenCalledWith('cu123456', 'old-hash');
    expect(prisma.user.update.mock.calls[0][0]).toEqual({
      where: { id: userId },
      data: { passwordHash: 'new-hash' },
    });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId } });
  });

  it('sai mật khẩu hiện tại thì không đổi', async () => {
    hashing.compare.mockResolvedValue(false);
    const res = await service.changePassword(userId, {
      currentPassword: 'sai',
      newPassword: 'moi123456',
    });
    expect(res.isSuccess).toBe(false);
    expect(res.message).toBe('Mật khẩu hiện tại không đúng');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('từ chối mật khẩu mới quá ngắn hoặc trùng mật khẩu cũ', async () => {
    const short = await service.changePassword(userId, { currentPassword: 'cu123456', newPassword: '123' });
    const same = await service.changePassword(userId, {
      currentPassword: 'cu123456',
      newPassword: 'cu123456',
    });
    expect(short.isSuccess).toBe(false);
    expect(same.isSuccess).toBe(false);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
