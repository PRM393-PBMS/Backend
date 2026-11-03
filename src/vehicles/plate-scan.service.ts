import { Injectable } from '@nestjs/common';
import { extname } from 'path';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import type { UploadedImage } from '../common/uploaded-image';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
/** Dịch vụ nhận diện tính tiền theo lượt: mỗi khách tối đa 10 ảnh mỗi 10 phút. */
const LIMIT = 10;
const WINDOW_MS = 10 * 60 * 1000;

/**
 * Khách chụp biển số để điền khi thêm xe. Không lưu ảnh (khác máy quét ở cổng),
 * chỉ trả biển số đọc được để khách kiểm tra trước khi lưu.
 */
@Injectable()
export class PlateScanService {
  // shortcut: đếm lượt trong bộ nhớ một máy chủ; chạy nhiều máy chủ thì chuyển sang Redis.
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly recognizer: PlateRecognizerService) {}

  async scan(userId: string, file: UploadedImage | undefined, now = Date.now()): Promise<PbmsResponseDto> {
    if (!file) return PbmsResponseDto.fail('Vui lòng gửi ảnh biển số');
    if (file.buffer.length > MAX_BYTES) return PbmsResponseDto.fail('Ảnh không được vượt quá 5MB');
    const ext = extname(file.originalname || '').toLowerCase();
    if (!IMAGE_MIME.has((file.mimetype ?? '').toLowerCase()) || (ext && !IMAGE_EXT.has(ext))) {
      return PbmsResponseDto.fail('Chỉ nhận ảnh JPEG, PNG hoặc WebP');
    }
    const times = (this.recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (times.length >= LIMIT) {
      return PbmsResponseDto.fail('Bạn đã chụp quá nhiều lần. Vui lòng nhập biển số hoặc thử lại sau ít phút.', 429);
    }
    this.recent.set(userId, [...times, now]);
    const result = await this.recognizer.recognize(file, null);
    if (!result.licensePlate) {
      return PbmsResponseDto.fail('Chưa đọc được biển số. Chụp gần, thẳng và đủ sáng hơn, hoặc nhập tay.', 422);
    }
    return PbmsResponseDto.ok('Đã đọc biển số', {
      licensePlate: result.licensePlate,
      confidence: result.confidence ?? null,
    });
  }
}
