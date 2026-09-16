import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Đánh dấu @Global() để PrismaService thành Singleton dùng chung trong toàn ứng dụng,
 * không cần import PrismaModule lặp lại ở các feature modules khác.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
