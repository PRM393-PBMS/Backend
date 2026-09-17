import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { GetPbmsRole } from '../auth/common/decorators/get-pbms-role.decorator';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ids, incidentExample, userExample } from '../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { FilesService } from '../integrations/payos-files.service';
import { IncidentsService } from './incidents.service';

@ApiTags('PBMS IncidentReport')
@ApiBearerAuth('JWT-auth')
@Controller('api/IncidentReport')
export class IncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly files: FilesService,
  ) {}

  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager', 'Staff')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get()
  @ApiOperation({ summary: 'Danh sách sự cố' })
  @ApiPbmsOkResponse('Lấy danh sách sự cố thành công', [incidentExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.incidents.getAll();
  }

  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get('assignees')
  @ApiOperation({ summary: 'Danh sách người có thể gán xử lý' })
  @ApiPbmsOkResponse('Lấy danh sách người xử lý thành công', [
    { userId: userExample.userId, fullName: userExample.fullName, roleName: 'Staff' },
  ])
  getAssignees(): Promise<PbmsResponseDto> {
    return this.incidents.getAssignees();
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Get('my-reports')
  @ApiOperation({ summary: 'Sự cố tôi đã báo' })
  @ApiPbmsOkResponse('Lấy sự cố của tôi thành công', [incidentExample])
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.incidents.getMine(userId);
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết sự cố' })
  @ApiPbmsOkResponse('Lấy sự cố thành công', incidentExample)
  getById(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.incidents.getById(id, userId, role);
  }

  @UseInterceptors(PbmsStatusInterceptor)
  @Post()
  @ApiOperation({ summary: 'Tạo báo cáo sự cố' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    sessionId: ids.sessionId,
    issueType: 'SlotOccupied',
    description: 'Ô B1-A12 đang bị chiếm khi đã gán cho khách tháng',
    proofImageUrl: 'https://api.example.com/uploads/incidents/proof.jpg',
  })
  @ApiPbmsOkResponse('Tạo báo cáo sự cố thành công', incidentExample, 201)
  create(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.incidents.create(userId, dto);
  }

  @Post('upload-proof')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload ảnh chứng minh sự cố' })
  async uploadProof(
    @UploadedFile() file: import('../common/uploaded-image').UploadedImage,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!file) {
      res.status(400).json({ message: 'Vui lòng gửi file ảnh' });
      return;
    }
    const upload = await this.files.saveUpload(file, `${req.protocol}://${req.get('host')}`, 'incidents');
    res.status(200).json({ imageUrl: upload.imageUrl });
  }

  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Put()
  @ApiOperation({ summary: 'Cập nhật sự cố' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    incidentId: ids.incidentId,
    issueType: 'SlotOccupied',
    description: 'Ô B1-A12 đang bị chiếm khi đã gán cho khách tháng',
    status: 'InProgress',
  })
  @ApiPbmsOkResponse('Cập nhật sự cố thành công', incidentExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.incidents.update(dto);
  }

  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Put(':id/assign/:staffId')
  @ApiOperation({ summary: 'Gán nhân viên xử lý sự cố' })
  @ApiPbmsOkResponse('Gán nhân viên xử lý thành công', {
    ...incidentExample,
    handledByStaffId: ids.staffId,
    status: 'InProgress',
  })
  assign(@Param('id') id: string, @Param('staffId') staffId: string): Promise<PbmsResponseDto> {
    return this.incidents.assign(id, staffId);
  }

  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Put(':id/resolve/:staffId')
  @ApiOperation({ summary: 'Đánh dấu sự cố đã xử lý' })
  @ApiPbmsBodyExample(PbmsBodyDto, { resolutionNotes: 'Đã xác minh và giải phóng ô đỗ' })
  @ApiPbmsOkResponse('Đã xử lý sự cố thành công', {
    ...incidentExample,
    status: 'Resolved',
    handledByStaffId: ids.staffId,
    resolvedAt: '2026-09-17T14:00:00.000Z',
    resolutionNotes: 'Đã xác minh và giải phóng ô đỗ',
  })
  resolve(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.incidents.resolve(id, staffId, dto);
  }

  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Delete(':id')
  @ApiOperation({ summary: 'Xóa sự cố' })
  @ApiPbmsOkResponse('Xóa sự cố thành công', null)
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.incidents.remove(id);
  }
}
