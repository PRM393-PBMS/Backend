import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/common/decorators/public.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { FloorsService } from './floors.service';
import { GatesService } from './gates.service';
import { ParkingSlotsService } from './parking-slots.service';
import { PricingPoliciesService } from './pricing-policies.service';
import { SubscriptionPackagesService } from './subscription-packages.service';
import { VehicleTypesService } from './vehicle-types.service';

@ApiTags('PBMS VehicleType')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/VehicleType')
export class VehicleTypesController {
  constructor(private readonly vehicleTypes: VehicleTypesService) {}

  @Get()
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Danh sách loại phương tiện' })
  getAll(): Promise<PbmsResponseDto> {
    return this.vehicleTypes.getAll();
  }

  @Get(':id')
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Chi tiết loại phương tiện' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.vehicleTypes.getById(id);
  }

  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo loại phương tiện' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.vehicleTypes.create(dto);
  }

  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật loại phương tiện' })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.vehicleTypes.update(dto);
  }

  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa loại phương tiện' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.vehicleTypes.remove(id);
  }
}

@ApiTags('PBMS Floor')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/Floor')
export class FloorsController {
  constructor(private readonly floors: FloorsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách tầng' })
  getAll(): Promise<PbmsResponseDto> {
    return this.floors.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết tầng' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.floors.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo tầng' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.floors.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật tầng' })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.floors.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa tầng' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.floors.remove(id);
  }
}

@ApiTags('PBMS Gate')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/Gate')
export class GatesController {
  constructor(private readonly gates: GatesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách cổng' })
  getAll(): Promise<PbmsResponseDto> {
    return this.gates.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết cổng' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.gates.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo cổng' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.gates.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật cổng' })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.gates.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa cổng' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.gates.remove(id);
  }
}

@ApiTags('PBMS ParkingSlot')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/ParkingSlot')
export class ParkingSlotsController {
  constructor(private readonly parkingSlots: ParkingSlotsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách ô đỗ' })
  getAll(): Promise<PbmsResponseDto> {
    return this.parkingSlots.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết ô đỗ' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.parkingSlots.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo ô đỗ' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.parkingSlots.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật ô đỗ' })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.parkingSlots.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Patch(':id/status')
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Cập nhật trạng thái ô đỗ' })
  updateStatus(@Param('id') id: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.parkingSlots.updateStatus(id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa ô đỗ' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.parkingSlots.remove(id);
  }
}

@ApiTags('PBMS PricingPolicy')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/PricingPolicy')
export class PricingPoliciesController {
  constructor(private readonly pricing: PricingPoliciesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách chính sách giá' })
  getAll(): Promise<PbmsResponseDto> {
    return this.pricing.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết chính sách giá' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.pricing.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo chính sách giá' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.pricing.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật chính sách giá' })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.pricing.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa chính sách giá' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.pricing.remove(id);
  }
}

@ApiTags('PBMS SubscriptionPackage')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/SubscriptionPackage')
export class SubscriptionPackagesController {
  constructor(private readonly packages: SubscriptionPackagesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Danh sách gói thuê bao' })
  getAll(): Promise<PbmsResponseDto> {
    return this.packages.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết gói thuê bao' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.packages.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo gói thuê bao' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.packages.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật gói thuê bao' })
  update(@Param('id') id: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.packages.update(id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa gói thuê bao' })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.packages.remove(id);
  }
}
