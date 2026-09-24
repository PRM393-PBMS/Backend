import { Controller, Get, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { reportSummaryExample, reportTypesExample } from '../common/swagger/pbms-example-data';
import { ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { ReportsService } from './reports.service';

@ApiTags('PBMS Reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@PbmsRoles('manager', 'admin')
@Controller('api/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('types')
  @ApiOperation({ summary: 'Danh sách loại báo cáo' })
  @ApiPbmsOkResponse('Lấy danh sách loại báo cáo thành công', reportTypesExample)
  types(): PbmsResponseDto {
    return this.reports.getTypes();
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('summary')
  @ApiOperation({ summary: 'Báo cáo tổng quan' })
  @ApiPbmsOkResponse('Lấy báo cáo tổng quan thành công', reportSummaryExample)
  summary(@Query() query: Record<string, string | undefined>): Promise<PbmsResponseDto> {
    return this.reports.summary(query);
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('revenue')
  @ApiOperation({ summary: 'Báo cáo doanh thu' })
  @ApiPbmsOkResponse('Lấy báo cáo doanh thu thành công', {
    ...reportSummaryExample,
    totalRevenue: 12500000,
    successfulPaymentCount: 48,
    averagePaymentAmount: 260416,
  })
  revenue(@Query() query: Record<string, string | undefined>): Promise<PbmsResponseDto> {
    return this.reports.revenue(query);
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('operations')
  @ApiOperation({ summary: 'Báo cáo vận hành' })
  @ApiPbmsOkResponse('Lấy báo cáo vận hành thành công', {
    range: reportSummaryExample.range,
    sessions: { entries: 210, exits: 198, activeSessions: 12, completedSessions: 198, averageParkingMinutes: 95 },
    reservations: {
      total: 40,
      pending: 2,
      confirmed: 10,
      checkedIn: 5,
      completed: 20,
      cancelled: 2,
      noShow: 1,
    },
    incidents: { openIncidents: 1, inProgressIncidents: 1, resolvedInRange: 3 },
  })
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
