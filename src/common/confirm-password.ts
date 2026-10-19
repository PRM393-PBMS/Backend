import { HashingService } from '../auth/services/hashing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from './dto/pbms-response.dto';
import { pbmsPick } from './pbms-fields';

/**
 * Xác thực lại mật khẩu trước thao tác nhạy cảm của khách (huỷ vé, gia hạn, đổi biển số).
 * Trả null khi đúng mật khẩu, ngược lại trả lỗi để controller trả về ngay.
 */
export async function confirmPassword(
  prisma: PrismaService,
  hashing: HashingService,
  userId: string,
  dto: object,
): Promise<PbmsResponseDto | null> {
  const password = pbmsPick(dto, 'password', 'Password');
  if (!password) {
    return PbmsResponseDto.fail('Vui lòng nhập mật khẩu để xác nhận thao tác này');
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await hashing.compare(password, user.passwordHash))) {
    return PbmsResponseDto.fail('Mật khẩu không đúng');
  }
  return null;
}
