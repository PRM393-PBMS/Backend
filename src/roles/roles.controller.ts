import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('PBMS Role')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@PbmsRoles('Admin', 'admin')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/Role')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách quyền' })
  getAll(): Promise<PbmsResponseDto> {
    return this.roles.getAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết quyền' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.roles.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo quyền' })
  create(@Body() dto: CreateRoleDto): Promise<PbmsResponseDto> {
    return this.roles.create(dto);
  }

  @Put()
  @ApiOperation({ summary: 'Cập nhật quyền' })
  update(@Body() dto: UpdateRoleDto): Promise<PbmsResponseDto> {
    return this.roles.update(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa quyền' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.roles.remove(id);
  }
}
