import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';
import { OtpStoreService } from './auth/services/otp-store.service';
import { AppError } from './common/errors';

@Controller('health')
export class ReadinessController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpStoreService,
  ) {}
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.otp.ready();
      return { status: 'ready' };
    } catch {
      throw new AppError(503, 'NOT_READY', 'Dịch vụ chưa sẵn sàng');
    }
  }
}
