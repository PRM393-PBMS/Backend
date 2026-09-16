import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['error', 'warn'],
    });
  }

  /**
   * Khởi tạo kết nối tới cơ sở dữ liệu PostgreSQL khi ứng dụng khởi chạy
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('✅ Đã kết nối thành công tới PostgreSQL Database qua Prisma ORM.');
    } catch (error: unknown) {
      this.logger.error('❌ Kết nối tới PostgreSQL thất bại:', error);
      throw error;
    }
  }

  /**
   * Đảm bảo đóng kết nối an toàn khi server nhận tín hiệu dừng (Graceful Shutdown)
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('🔌 Đã ngắt kết nối cơ sở dữ liệu an toàn.');
  }
}
