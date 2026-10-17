import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { roleExample, userExample } from '../common/swagger/pbms-example-data';
import { ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { CreateUserDto, UpdateUserDto, UpdateUserStatusDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('PBMS User')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@PbmsRoles('Admin', 'Manager')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/User')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('all')
  @ApiOperation({ summary: 'Danh sách người dùng' })
  @ApiPbmsOkResponse('Lấy danh sách người dùng thành công', [userExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.users.getAll();
  }

  @Get('roles')
  @ApiOperation({ summary: 'Danh sách quyền có thể gán' })
  @ApiPbmsOkResponse('Lấy danh sách quyền có thể gán thành công', [roleExample])
  getRoles(): Promise<PbmsResponseDto> {
    return this.users.getManageableRoles();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết người dùng' })
  @ApiPbmsOkResponse('Tìm thấy người dùng thành công', userExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.users.getById(id);
  }

  @Post('create')
  @ApiOperation({ summary: 'Tạo người dùng' })
  @ApiPbmsOkResponse('Tạo người dùng thành công', userExample, 201)
  create(@Body() dto: CreateUserDto): Promise<PbmsResponseDto> {
    return this.users.create(dto);
  }

  @Put('update')
  @ApiOperation({ summary: 'Cập nhật người dùng' })
  @ApiPbmsOkResponse('Cập nhật người dùng thành công', userExample)
  update(@Body() dto: UpdateUserDto): Promise<PbmsResponseDto> {
    return this.users.update(dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cập nhật trạng thái người dùng' })
  @ApiPbmsOkResponse('Cập nhật trạng thái người dùng thành công', userExample)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<PbmsResponseDto> {
    return this.users.updateStatus(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Vô hiệu hóa người dùng' })
  @ApiPbmsOkResponse('Xóa người dùng thành công', { ...userExample, status: 'Inactive' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.users.remove(id);
  }
}
