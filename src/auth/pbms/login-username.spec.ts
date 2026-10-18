import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../services/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HashingService } from '../services/hashing.service';
import { OtpStoreService } from '../services/otp-store.service';
import { PbmsAuthService } from './pbms-auth.service';

describe('PbmsAuthService: đăng nhập bằng tên đăng nhập', () => {
  let service: PbmsAuthService;
  let findFirst: jest.Mock;

  beforeEach(async () => {
    findFirst = jest.fn().mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PbmsAuthService,
        { provide: PrismaService, useValue: { user: { findFirst } } },
        { provide: HashingService, useValue: { compare: jest.fn(), hash: jest.fn() } },
        { provide: JwtService, useValue: { signAsync: jest.fn(), verifyAsync: jest.fn() } },
        { provide: MailService, useValue: { sendOtpEmail: jest.fn() } },
        { provide: OtpStoreService, useValue: { set: jest.fn(), get: jest.fn(), delete: jest.fn() } },
      ],
    }).compile();
    service = module.get(PbmsAuthService);
  });

  it('ô "email" không có @ thì tìm theo tên đăng nhập, không phân biệt hoa thường', async () => {
    await service.login({ email: '  Alice ', password: 'x' });
    expect(findFirst.mock.calls[0][0].where).toEqual({
      userName: { equals: 'Alice', mode: 'insensitive' },
    });
  });

  it('nhận cả field userName', async () => {
    await service.login({ userName: 'bob', password: 'x' } as never);
    expect(findFirst.mock.calls[0][0].where).toEqual({
      userName: { equals: 'bob', mode: 'insensitive' },
    });
  });

  it('có @ thì vẫn tìm theo email như cũ', async () => {
    await service.login({ email: 'A@Example.com', password: 'x' });
    expect(findFirst.mock.calls[0][0].where).toEqual({
      email: { equals: 'a@example.com', mode: 'insensitive' },
    });
  });
});
