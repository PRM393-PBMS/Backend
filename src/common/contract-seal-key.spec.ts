import { generateKeyPairSync } from 'crypto';
import { normalizeSealKeyPem, readSealKey, sealKeyFromPem } from './contract-seal';

describe('Đọc khoá niêm phong hợp đồng từ biến môi trường', () => {
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
    .trim();
  const keyId = sealKeyFromPem(pem).keyId;
  const escaped = pem.replace(/\n/g, '\n');
  const body = pem.split('\n').slice(1, -1).join('');
  const original = process.env.CONTRACT_SIGNING_PRIVATE_KEY;

  afterAll(() => {
    process.env.CONTRACT_SIGNING_PRIVATE_KEY = original;
  });

  it.each([
    ['PEM nhiều dòng', pem],
    ['một dòng với \n dạng chữ (đúng như script in ra)', escaped],
    ['còn dấu ngoặc kép', `"${escaped}"`],
    ['dán cả dòng KEY=...', `CONTRACT_SIGNING_PRIVATE_KEY="${escaped}"`],
    ['xuống dòng bị đổi thành dấu cách', pem.replace(/\n/g, ' ')],
    ['chỉ phần base64', body],
  ])('chấp nhận: %s', (_label, value) => {
    expect(sealKeyFromPem(normalizeSealKeyPem(value)).keyId).toBe(keyId);
  });

  it('thiếu khoá hoặc khoá sai: báo lý do, không ném lỗi (không còn lỗi 500)', () => {
    process.env.CONTRACT_SIGNING_PRIVATE_KEY = '';
    expect(readSealKey()).toEqual({ key: null, problem: 'missing' });
    process.env.CONTRACT_SIGNING_PRIVATE_KEY = 'cgi';
    expect(readSealKey()).toEqual({ key: null, problem: 'invalid' });
    process.env.CONTRACT_SIGNING_PRIVATE_KEY = `"${escaped}"`;
    expect(readSealKey().key?.keyId).toBe(keyId);
  });
});
