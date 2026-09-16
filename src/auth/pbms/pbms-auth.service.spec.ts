import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HashingService } from '../services/hashing.service';
import { MailService } from '../services/mail.service';
import { OtpStoreService } from '../services/otp-store.service';
import { PbmsAuthService } from './pbms-auth.service';

describe('PbmsAuthService', () => {
  let service: PbmsAuthService;
  let prisma: {
    user: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    role: { findFirst: jest.Mock };
    refreshToken: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let hashingService: { compare: jest.Mock; hash: jest.Mock };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let mailService: { sendEmail: jest.Mock };

  const activeUser = {
    id: 'user-1',
    email: 'a@example.com',
    passwordHash: 'hash',
    userName: 'alice',
    fullName: 'Alice',
    phoneNumber: '0912345678',
    status: 'Active',
    isActive: true,
    role: UserRole.USER,
    pbmsRoleId: 'role-user',
    pbmsRole: { roleName: 'User' },
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      role: { findFirst: jest.fn() },
      refreshToken: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    hashingService = {
      compare: jest.fn(),
      hash: jest.fn().mockResolvedValue('hashed'),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      verifyAsync: jest.fn(),
    };
    mailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PbmsAuthService,
        OtpStoreService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: hashingService },
        { provide: JwtService, useValue: jwtService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get(PbmsAuthService);
  });

  describe('login', () => {
    it('returns 400 when the user is missing', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.login({ email: 'missing@example.com', password: 'x' });

      expect(result.statusCode).toBe(400);
      expect(result.isSuccess).toBe(false);
      expect(result.message).toBe('Không tìm thấy người dùng');
    });

    it('returns 400 when the password is wrong', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser);
      hashingService.compare.mockResolvedValue(false);

      const result = await service.login({ Email: 'a@example.com', Password: 'bad' });

      expect(result.statusCode).toBe(400);
      expect(result.message).toBe('Sai mật khẩu');
    });

    it('returns 403 when the account is banned', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...activeUser,
        status: 'Banned',
        isActive: false,
      });
      hashingService.compare.mockResolvedValue(true);

      const result = await service.login({ email: 'a@example.com', password: 'ok' });

      expect(result.statusCode).toBe(403);
      expect(result.message).toBe('Tài khoản của bạn đã bị khóa');
    });

    it('returns tokens in the standard envelope on success', async () => {
      prisma.user.findFirst.mockResolvedValue(activeUser);
      hashingService.compare.mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login({ email: 'a@example.com', password: 'ok' });

      expect(result.statusCode).toBe(200);
      expect(result.isSuccess).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          accessToken: 'signed-token',
          refreshToken: 'signed-token',
          user: expect.objectContaining({
            userId: 'user-1',
            userName: 'alice',
            roleName: 'User',
          }),
        }),
      );
    });
  });

  describe('sendRegisterOtp', () => {
    it('returns 400 when UserName is missing', async () => {
      const result = await service.sendRegisterOtp({ email: 'a@example.com' });
      expect(result.statusCode).toBe(400);
      expect(result.message).toBe('Vui lòng nhập UserName');
    });

    it('sends OTP when registration fields are valid', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.sendRegisterOtp({
        userName: 'alice',
        fullName: 'Alice',
        email: 'a@example.com',
        phoneNumber: '0912345678',
        password: 'Secret1',
        confirmPassword: 'Secret1',
      });

      expect(result.statusCode).toBe(200);
      expect(result.isSuccess).toBe(true);
      expect(mailService.sendEmail).toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    it('returns 400 when the refresh token is empty', async () => {
      const result = await service.refreshToken({});
      expect(result.statusCode).toBe(400);
      expect(result.message).toBe('Vui lòng nhập refresh token');
    });
  });

  describe('logout', () => {
    it('returns success even when the token is unknown', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad'));
      prisma.refreshToken.findMany.mockResolvedValue([]);

      const result = await service.logout({ refreshTokenKey: 'unknown' });

      expect(result.statusCode).toBe(200);
      expect(result.isSuccess).toBe(true);
      expect(result.message).toBe('Đăng xuất thành công');
    });
  });
});
