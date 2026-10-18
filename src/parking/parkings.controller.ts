import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import {
  CreateParkingDto,
  ParkingIdParamDto,
  ParkingResponseDto,
  ParkingSlotResponseDto,
  UpdateParkingDto,
} from './dto/parking.dto';
import { ParkingsService } from './parkings.service';

@ApiTags('Parking')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@Controller('parkings')
export class ParkingsController {
  constructor(private readonly parkings: ParkingsService) {}

  @Post()
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Tạo bãi đỗ' })
  create(@Body() dto: CreateParkingDto): Promise<ParkingResponseDto> {
    return this.parkings.create(dto);
  }

  @Get()
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Danh sách bãi đỗ' })
  findAll(): Promise<ParkingResponseDto[]> {
    return this.parkings.findAll();
  }

  @Get(':id/slots')
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Danh sách ô đỗ của một bãi' })
  findSlots(
    @Param() params: ParkingIdParamDto,
  ): Promise<ParkingSlotResponseDto[]> {
    return this.parkings.findSlots(params.id);
  }

  @Get(':id')
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Chi tiết bãi đỗ' })
  findOne(@Param() params: ParkingIdParamDto): Promise<ParkingResponseDto> {
    return this.parkings.findOne(params.id);
  }

  @Patch(':id')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Cập nhật tên hoặc địa điểm bãi đỗ' })
  update(
    @Param() params: ParkingIdParamDto,
    @Body() dto: UpdateParkingDto,
  ): Promise<ParkingResponseDto> {
    return this.parkings.update(params.id, dto);
  }

  @Delete(':id')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Xóa bãi đỗ không còn ô đỗ' })
  remove(@Param() params: ParkingIdParamDto): Promise<ParkingResponseDto> {
    return this.parkings.remove(params.id);
  }
}
