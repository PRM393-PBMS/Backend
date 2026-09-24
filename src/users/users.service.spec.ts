import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from '../auth/services/hashing.service';
import { FilesService } from '../integrations/payos-files.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let files: { saveUpload: jest.Mock };

  const existing = {
    id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    userName: 'alice',
    email: 'a@example.com',
    fullName: 'Alice',
    phoneNumber: '0912345678',
    status: 'Active',
    roleId: 1,
    avatarUrl: null as string | null,
    createdAt: new Date('2026-09-10T07:00:00.000Z'),
    updatedAt: new Date('2026-09-15T08:30:00.000Z'),
    pbmsRole: { roleName: 'customer' },
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    files = {
      saveUpload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: { hash: jest.fn() } },
        { provide: FilesService, useValue: files },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('updateAvatar', () => {
    const jpeg = {
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      originalname: 'me.jpg',
      mimetype: 'image/jpeg',
    };

    it('returns 401 when the caller is missing', async () => {
      const result = await service.updateAvatar('', jpeg, 'http://localhost:3000');
      expect(result.statusCode).toBe(401);
      expect(result.message).toBe('Vui lòng đăng nhập');
    });

    it('returns 400 when the file is missing', async () => {
      const result = await service.updateAvatar(existing.id, undefined, 'http://localhost:3000');
      expect(result.statusCode).toBe(400);
      expect(result.message).toBe('Vui lòng gửi file ảnh');
    });

    it('returns 400 when the file is not jpeg/png/webp', async () => {
      const result = await service.updateAvatar(
        existing.id,
        { buffer: Buffer.from('gif'), originalname: 'me.gif', mimetype: 'image/gif' },
        'http://localhost:3000',
      );
      expect(result.statusCode).toBe(400);
      expect(result.message).toBe('Ảnh đại diện chỉ nhận JPEG, PNG hoặc WebP');
    });

    it('returns 404 when the user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.updateAvatar(existing.id, jpeg, 'http://localhost:3000');
      expect(result.statusCode).toBe(404);
      expect(result.message).toBe('Không tìm thấy người dùng');
    });

    it('stores the public URL and returns the mapped user', async () => {
      prisma.user.findUnique.mockResolvedValue(existing);
      files.saveUpload.mockResolvedValue({
        imageUrl: 'http://localhost:3000/uploads/avatars/abc.jpg',
        fileName: 'abc.jpg',
      });
      prisma.user.update.mockResolvedValue({
        ...existing,
        avatarUrl: 'http://localhost:3000/uploads/avatars/abc.jpg',
      });

      const result = await service.updateAvatar(existing.id, jpeg, 'http://localhost:3000');

      expect(files.saveUpload).toHaveBeenCalledWith(jpeg, 'http://localhost:3000', 'avatars');
      expect(result.statusCode).toBe(200);
      expect(result.isSuccess).toBe(true);
      expect(result.message).toBe('Cập nhật ảnh đại diện thành công');
      expect(result.result).toEqual(
        expect.objectContaining({
          userId: existing.id,
          avatarUrl: 'http://localhost:3000/uploads/avatars/abc.jpg',
        }),
      );
    });
  });
});
