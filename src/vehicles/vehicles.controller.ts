import { Body, Controller, Delete, Get, Param, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ids } from '../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { VehiclesService } from './vehicles.service';

const vehicleExample = {
  vehicleId: ids.vehicleId,
  userId: ids.userId,
  vehicleTypeId: ids.vehicleTypeId,
  vehicleTypeName: 'Ô tô',
  licensePlate: '59A12345',
};

@ApiTags('PBMS Vehicles')
@ApiBearerAuth('JWT-auth')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Post()
  @ApiOperation({ summary: 'Đăng ký xe của tôi' })
  @ApiPbmsBodyExample(PbmsBodyDto, { vehicleTypeId: ids.vehicleTypeId, licensePlate: '59A12345' })
  @ApiPbmsOkResponse('Đăng ký xe thành công', vehicleExample, 201)
  create(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.vehicles.create(userId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Danh sách xe của tôi' })
  @ApiPbmsOkResponse('Lấy danh sách xe thành công', [vehicleExample])
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.vehicles.getMine(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết xe của tôi' })
  @ApiPbmsOkResponse('Lấy thông tin xe thành công', vehicleExample)
  getById(@GetPbmsUserId() userId: string, @Param('id') id: string): Promise<PbmsResponseDto> {
    return this.vehicles.getById(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Cập nhật xe của tôi' })
  @ApiPbmsBodyExample(PbmsBodyDto, { licensePlate: '59A67890' })
  @ApiPbmsOkResponse('Cập nhật xe thành công', vehicleExample)
  update(
    @GetPbmsUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.vehicles.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xóa xe chưa từng được dùng trong nghiệp vụ' })
  @ApiPbmsOkResponse('Xóa xe thành công', null)
  remove(@GetPbmsUserId() userId: string, @Param('id') id: string): Promise<PbmsResponseDto> {
    return this.vehicles.remove(userId, id);
  }
}
