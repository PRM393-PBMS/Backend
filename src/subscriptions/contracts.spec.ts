import { generateKeyPairSync } from 'crypto';
import {
  decodeSignaturePng,
  requiresContract,
  sealKeyFromPem,
  sealPayload,
  sha256Hex,
  signSeal,
  verifySeal,
} from '../common/contract-seal';
import { PrismaService } from '../prisma/prisma.service';
import { ContractsService } from './contracts.service';

const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

// PNG 1x1 hợp lệ, đệm thêm byte để vượt ngưỡng kích thước tối thiểu.
const png = Buffer.concat([
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
  Buffer.alloc(64),
]);
const pngDataUrl = `data:image/png;base64,${png.toString('base64')}`;

describe('Niêm phong hợp đồng', () => {
  const key = sealKeyFromPem(pem.replace(/\n/g, '\\n')); // như khi đọc từ .env
  const fields = {
    contractNumber: 'HD-20261017-ABC123',
    contentHash: sha256Hex('nội dung hợp đồng'),
    signatureImageHash: sha256Hex(png),
    signedAt: new Date('2026-10-17T07:00:00.000Z'),
    userId: 'user-1',
  };

  it('chỉ áp dụng cho gói từ 3 tháng', () => {
    expect([1, 2, 3, 6, 9, 12].map(requiresContract)).toEqual([false, false, true, true, true, true]);
  });

  it('ký rồi kiểm tra lại được', () => {
    const seal = signSeal(sealPayload(fields), key);
    expect(verifySeal(sealPayload(fields), seal, key.publicKey)).toBe(true);
  });

  it('phát hiện nội dung bị sửa sau khi ký', () => {
    const seal = signSeal(sealPayload(fields), key);
    const tampered = { ...fields, contentHash: sha256Hex('nội dung hợp đồng (đã sửa giá)') };
    expect(verifySeal(sealPayload(tampered), seal, key.publicKey)).toBe(false);
  });

  it('phát hiện chữ ký tay bị thay', () => {
    const seal = signSeal(sealPayload(fields), key);
    const swapped = { ...fields, signatureImageHash: sha256Hex(Buffer.alloc(200)) };
    expect(verifySeal(sealPayload(swapped), seal, key.publicKey)).toBe(false);
  });

  it('khoá khác không xác nhận được niêm phong', () => {
    const other = sealKeyFromPem(
      generateKeyPairSync('ec', { namedCurve: 'P-256' })
        .privateKey.export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    );
    const seal = signSeal(sealPayload(fields), key);
    expect(verifySeal(sealPayload(fields), seal, other.publicKey)).toBe(false);
    expect(other.keyId).not.toBe(key.keyId);
  });

  it('chỉ nhận ảnh PNG hợp lệ', () => {
    expect(decodeSignaturePng(pngDataUrl)?.equals(png)).toBe(true);
    expect(decodeSignaturePng('data:image/png;base64,AAAA')).toBeNull();
    expect(decodeSignaturePng(Buffer.alloc(300).toString('base64'))).toBeNull();
    expect(decodeSignaturePng(Buffer.alloc(300 * 1024).toString('base64'))).toBeNull();
  });
});

describe('ContractsService.sign', () => {
  const content = 'HỢP ĐỒNG DỊCH VỤ GỬI XE THEO THÁNG';
  const pending = {
    id: 'c1',
    subscriptionId: 's1',
    userId: 'user-1',
    contractNumber: 'HD-20261017-ABC123',
    content,
    contentHash: sha256Hex(content),
    status: 'PendingSignature',
    signerName: null,
    signatureImage: null,
    signedAt: null,
    sealKeyId: null,
    createdAt: new Date(),
    subscription: { status: 'PendingPayment' },
  };

  function setup() {
    const prisma = {
      subscriptionContract: {
        findUnique: jest.fn().mockResolvedValue(pending),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...pending, status: 'Signed' }),
      },
    };
    return { prisma, service: new ContractsService(prisma as unknown as PrismaService) };
  }

  const body = {
    agreed: true,
    signerName: 'Nguyễn Văn A',
    contentHash: sha256Hex(content),
    signatureImage: pngDataUrl,
  };

  beforeEach(() => {
    process.env.CONTRACT_SIGNING_PRIVATE_KEY = pem;
  });
  afterAll(() => {
    delete process.env.CONTRACT_SIGNING_PRIVATE_KEY;
  });

  it('ký thành công: lưu chữ ký, niêm phong, chỉ chuyển từ PendingSignature', async () => {
    const { prisma, service } = setup();
    const res = await service.sign('c1', 'user-1', body, '10.0.0.1');

    expect(res.isSuccess).toBe(true);
    const call = prisma.subscriptionContract.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'c1', status: 'PendingSignature' });
    expect(call.data.status).toBe('Signed');
    expect(call.data.signatureImageHash).toBe(sha256Hex(png));
    expect(typeof call.data.seal).toBe('string');
    expect(call.data.sealKeyId).toBe(sealKeyFromPem(pem).keyId);
  });

  it('từ chối khi chưa đồng ý điều khoản', async () => {
    const { service, prisma } = setup();
    const res = await service.sign('c1', 'user-1', { ...body, agreed: false }, null);
    expect(res.isSuccess).toBe(false);
    expect(prisma.subscriptionContract.updateMany).not.toHaveBeenCalled();
  });

  it('từ chối khi nội dung người dùng đã xem khác bản lưu', async () => {
    const { service } = setup();
    const res = await service.sign('c1', 'user-1', { ...body, contentHash: sha256Hex('bản cũ') }, null);
    expect(res.statusCode).toBe(409);
  });

  it('người khác không ký hộ được', async () => {
    const { service } = setup();
    const res = await service.sign('c1', 'user-2', body, null);
    expect(res.statusCode).toBe(403);
  });

  it('thiếu khoá niêm phong thì báo lỗi cấu hình, không ký', async () => {
    delete process.env.CONTRACT_SIGNING_PRIVATE_KEY;
    const { service, prisma } = setup();
    const res = await service.sign('c1', 'user-1', body, null);
    expect(res.statusCode).toBe(503);
    expect(prisma.subscriptionContract.updateMany).not.toHaveBeenCalled();
  });
});
