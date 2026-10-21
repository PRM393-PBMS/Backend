import { createHash } from 'crypto';
import { HashingService } from '../auth/services/hashing.service';
import { MailService } from '../auth/services/mail.service';
import { OtpStoreService } from '../auth/services/otp-store.service';
import { FilesService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailChangeService } from './email-change.service';
import { UsersService } from './users.service';

describe('Đổi thông tin đăng nhập', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const sha = (v: string) => createHash('sha256').update(v).digest('hex');
  let prisma: {
    user: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };
  let hashing: { compare: jest.Mock; hash: jest.Mock };
  let mail: { sendOtpEmail: jest.Mock };
  let store: Map<string, unknown>;
  let otpStore: { set: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let service: EmailChangeService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: 'cu@gmail.com', passwordHash: 'h' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    hashing = { compare: jest.fn().mockResolvedValue(true), hash: jest.fn() };
    mail = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
    store = new Map();
    otpStore = {
      set: jest.fn((k: string, v: unknown) => Promise.resolve(void store.set(k, v))),
      get: jest.fn((k: string) => Promise.resolve(store.get(k))),
      delete: jest.fn((k: string) => Promise.resolve(void store.delete(k))),
    };
    service = new EmailChangeService(
      prisma as unknown as PrismaService,
      hashing as unknown as HashingService,
      mail as unknown as MailService,
      otpStore as unknown as OtpStoreService,
    );
  });

  describe('PUT /api/profile', () => {
    const users = () =>
      new UsersService(
        prisma as unknown as PrismaService,
        hashing as unknown as HashingService,
        {} as FilesService,
      );

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: userId, email: 'cu@gmail.com', pbmsRole: null, wallet: null });
    });

    it('từ chối đổi mật khẩu qua PUT hồ sơ (không có mật khẩu cũ)', async () => {
      const res = await users().updateProfile(userId, { fullName: 'A', password: 'moi123' });
      expect(res.statusCode).toBe(400);
      expect(res.message).toContain('change-password');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(hashing.hash).not.toHaveBeenCalled();
    });

    it('từ chối đổi sang email khác qua PUT hồ sơ', async () => {
      const res = await users().updateProfile(userId, { email: 'moi@gmail.com' });
      expect(res.statusCode).toBe(400);
      expect(res.message).toContain('change-email');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('gửi lại đúng email hiện tại thì vẫn cập nhật tên bình thường', async () => {
      prisma.user.update.mockResolvedValue({
        id: userId,
        email: 'cu@gmail.com',
        fullName: 'Tên Mới',
        pbmsRole: null,
        wallet: null,
      });
      const res = await users().updateProfile(userId, { email: 'CU@gmail.com', fullName: 'Tên Mới' });
      expect(res.isSuccess).toBe(true);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ fullName: 'Tên Mới' });
    });
  });

  it('bước 1: sai mật khẩu thì không gửi OTP', async () => {
    hashing.compare.mockResolvedValue(false);
    const res = await service.request(userId, { newEmail: 'moi@gmail.com', password: 'x' });
    expect(res.message).toBe('Mật khẩu không đúng');
    expect(mail.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('bước 1: email đã có người dùng thì từ chối', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'other' });
    const res = await service.request(userId, { newEmail: 'moi@gmail.com', password: 'x' });
    expect(res.message).toBe('Email đã được sử dụng');
  });

  it('bước 1 gửi OTP tới email MỚI, chưa đổi email; bước 2 đúng mã mới đổi', async () => {
    const res = await service.request(userId, { newEmail: 'Moi@Gmail.com', password: 'x' });
    expect(res.isSuccess).toBe(true);
    expect(mail.sendOtpEmail).toHaveBeenCalledWith('moi@gmail.com', expect.stringMatching(/^\d{6}$/), 'email-change');
    expect(prisma.user.update).not.toHaveBeenCalled();

    const otp = mail.sendOtpEmail.mock.calls[0][1] as string;
    const done = await service.verify(userId, { otp });
    expect(done.isSuccess).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { email: 'moi@gmail.com', isEmailVerified: true },
    });
    expect(store.size).toBe(0);
  });

  it('bước 2: sai mã 5 lần thì huỷ mã', async () => {
    store.set(`EmailChange_${userId}`, { newEmail: 'moi@gmail.com', otpHash: sha('123456'), attempts: 0 });
    for (let i = 0; i < 4; i++) {
      expect((await service.verify(userId, { otp: '000000' })).message).toBe('Mã xác nhận không đúng');
    }
    expect((await service.verify(userId, { otp: '000000' })).message).toContain('quá nhiều lần');
    expect((await service.verify(userId, { otp: '123456' })).message).toContain('hết hạn');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('bước 2: email bị tài khoản khác lấy trong lúc chờ thì không đổi', async () => {
    store.set(`EmailChange_${userId}`, { newEmail: 'moi@gmail.com', otpHash: sha('123456'), attempts: 0 });
    prisma.user.findFirst.mockResolvedValue({ id: 'other' });
    const res = await service.verify(userId, { otp: '123456' });
    expect(res.message).toBe('Email đã được sử dụng');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
