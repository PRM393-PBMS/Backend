import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/common/decorators/public.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { PaymentsService } from './payments.service';

@ApiTags('PBMS Payments')
@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('payos-webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook PayOS (thành công: HTTP 200 body rỗng)' })
  async webhook(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    try {
      await this.payments.handleWebhook(body ?? {});
      res.status(200).send();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Lỗi xử lý webhook PayOS';
      res.status(500).json({
        statusCode: 500,
        message: message.startsWith('Lỗi xử lý webhook')
          ? message
          : `Lỗi xử lý webhook PayOS: ${message}`,
        isSuccess: false,
      });
    }
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get()
  @ApiOperation({ summary: 'Danh sách thanh toán' })
  getAll(): Promise<PbmsResponseDto> {
    return this.payments.getAll();
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết thanh toán' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.payments.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post()
  @ApiOperation({ summary: 'Tạo thanh toán' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.payments.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Put()
  @ApiOperation({ summary: 'Cập nhật thanh toán' })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.payments.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Delete(':id')
  @ApiOperation({ summary: 'Xóa thanh toán' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.payments.remove(id);
  }
}
