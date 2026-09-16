import { Controller, Get, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ReportsService } from './reports.service';

@ApiTags('PBMS Reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@PbmsRoles('Manager', 'manager', 'Admin', 'admin')
@Controller('api/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('types')
  @ApiOperation({ summary: 'Danh sách loại báo cáo' })
  types(): PbmsResponseDto {
    return this.reports.getTypes();
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('summary')
  @ApiOperation({ summary: 'Báo cáo tổng quan' })
  summary(@Query() query: Record<string, string | undefined>): Promise<PbmsResponseDto> {
    return this.reports.summary(query);
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('revenue')
  @ApiOperation({ summary: 'Báo cáo doanh thu' })
  revenue(@Query() query: Record<string, string | undefined>): Promise<PbmsResponseDto> {
    return this.reports.revenue(query);
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('operations')
  @ApiOperation({ summary: 'Báo cáo vận hành' })
  operations(@Query() query: Record<string, string | undefined>): Promise<PbmsResponseDto> {
    return this.reports.operations(query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Xuất báo cáo PDF' })
  async export(
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | PbmsResponseDto> {
    const result = await this.reports.exportPdf(query);
    if (result instanceof StreamableFile) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="pbms-report.pdf"');
    }
    return result;
  }
}
