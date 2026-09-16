import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class HashingService {
  // Salt rounds = 12 là tiêu chuẩn bảo mật Enterprise
  private readonly SALT_ROUNDS: number = 12;

  /**
   * Băm mật khẩu hoặc refresh token sang chuỗi bcrypt hash
   * @param rawData Chuỗi thô cần băm
   */
  async hash(rawData: string): Promise<string> {
    try {
      const salt = await bcrypt.genSalt(this.SALT_ROUNDS);
      return await bcrypt.hash(rawData, salt);
    } catch {
      throw new InternalServerErrorException('Lỗi trong quá trình mã hóa dữ liệu.');
    }
  }

  /**
   * So khớp an toàn giữa dữ liệu thô và chuỗi hash trong database
   * @param rawData Chuỗi thô do client gửi lên
   * @param encryptedData Chuỗi hash lưu trong database
   */
  async compare(rawData: string, encryptedData: string): Promise<boolean> {
    try {
      if (!rawData || !encryptedData) {
        return false;
      }
      return await bcrypt.compare(rawData, encryptedData);
    } catch {
      return false;
    }
  }
}
