export function requiredSecret(
  name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
): string {
  const secret = process.env[name]?.trim();
  if (!secret || secret.startsWith('REPLACE_') || secret.length < 32)
    throw new Error(`Cần cấu hình ${name} với ít nhất 32 ký tự`);
  return secret;
}
