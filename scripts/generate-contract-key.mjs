// Sinh khoá ECDSA P-256 để niêm phong hợp đồng vé tháng.
// Chạy: node scripts/generate-contract-key.mjs  rồi dán dòng in ra vào .env
// Giữ bí mật khoá riêng; đổi khoá sẽ làm hợp đồng cũ không kiểm tra được bằng khoá mới.
import { createHash, generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const keyId = createHash('sha256')
  .update(publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex')
  .slice(0, 16);

console.log(`# Mã khoá: ${keyId}`);
console.log(`CONTRACT_SIGNING_PRIVATE_KEY="${pem.trim().replace(/\n/g, '\\n')}"`);
