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
import {
  floorExample,
  gateExample,
  ids,
  packageExample,
  pricingPolicyExample,
  slotExample,
  vehicleTypeExample,
} from '../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
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
  @ApiPbmsOkResponse('Lấy danh sách loại phương tiện thành công', [vehicleTypeExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.vehicleTypes.getAll();
  }

  @Get(':id')
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Chi tiết loại phương tiện' })
  @ApiPbmsOkResponse('Lấy loại phương tiện thành công', vehicleTypeExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.vehicleTypes.getById(id);
  }

  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo loại phương tiện' })
  @ApiPbmsBodyExample(PbmsBodyDto, { typeName: 'Xe máy', dimensions: '2.0m x 0.8m' })
  @ApiPbmsOkResponse('Tạo loại phương tiện thành công', vehicleTypeExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.vehicleTypes.create(dto);
  }

  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật loại phương tiện' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    vehicleTypeId: ids.vehicleTypeId,
    typeName: 'Xe máy',
    dimensions: '2.0m x 0.8m',
  })
  @ApiPbmsOkResponse('Cập nhật loại phương tiện thành công', vehicleTypeExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.vehicleTypes.update(dto);
  }

  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa loại phương tiện' })
  @ApiPbmsOkResponse('Xóa loại phương tiện thành công', null)
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
  @ApiPbmsOkResponse('Lấy danh sách tầng thành công', [floorExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.floors.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết tầng' })
  @ApiPbmsOkResponse('Lấy thông tin tầng thành công', floorExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.floors.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo tầng' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    floorName: 'Tầng B1',
    dedicatedVehicleTypeId: ids.vehicleTypeId,
    totalCapacity: 120,
    isResident: false,
  })
  @ApiPbmsOkResponse('Tạo tầng thành công', floorExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.floors.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật tầng' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    floorId: ids.floorId,
    floorName: 'Tầng B1',
    dedicatedVehicleTypeId: ids.vehicleTypeId,
    totalCapacity: 120,
    isResident: false,
  })
  @ApiPbmsOkResponse('Cập nhật tầng thành công', floorExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.floors.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa tầng' })
  @ApiPbmsOkResponse('Xóa tầng thành công', null)
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
  @ApiPbmsOkResponse('Lấy danh sách cổng thành công', [gateExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.gates.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết cổng' })
  @ApiPbmsOkResponse('Lấy thông tin cổng thành công', gateExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.gates.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo cổng' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    floorId: ids.floorId,
    gateName: 'Cổng vào A',
    gateType: 'Entry',
  })
  @ApiPbmsOkResponse('Tạo cổng thành công', gateExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.gates.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật cổng' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    gateId: ids.gateEntryId,
    floorId: ids.floorId,
    gateName: 'Cổng vào A',
    gateType: 'Entry',
  })
  @ApiPbmsOkResponse('Cập nhật cổng thành công', gateExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.gates.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa cổng' })
  @ApiPbmsOkResponse('Xóa cổng thành công', null)
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
  @ApiPbmsOkResponse('Lấy danh sách ô đỗ thành công', [slotExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.parkingSlots.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết ô đỗ' })
  @ApiPbmsOkResponse('Lấy thông tin ô đỗ thành công', slotExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.parkingSlots.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo ô đỗ' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    floorId: ids.floorId,
    vehicleTypeId: ids.vehicleTypeId,
    slotCode: 'B1-A12',
    status: 'Available',
  })
  @ApiPbmsOkResponse('Tạo ô đỗ thành công', slotExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.parkingSlots.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật ô đỗ' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    parkingSlotId: ids.slotId,
    floorId: ids.floorId,
    vehicleTypeId: ids.vehicleTypeId,
    slotCode: 'B1-A12',
    status: 'Available',
  })
  @ApiPbmsOkResponse('Cập nhật ô đỗ thành công', slotExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.parkingSlots.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Patch(':id/status')
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Cập nhật trạng thái ô đỗ' })
  @ApiPbmsBodyExample(PbmsBodyDto, { status: 'Occupied' })
  @ApiPbmsOkResponse('Cập nhật trạng thái ô đỗ thành công', { ...slotExample, status: 'Occupied' })
  updateStatus(@Param('id') id: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.parkingSlots.updateStatus(id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa ô đỗ' })
  @ApiPbmsOkResponse('Xóa ô đỗ thành công', null)
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
  @ApiPbmsOkResponse('Lấy danh sách chính sách giá thành công', [pricingPolicyExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.pricing.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết chính sách giá' })
  @ApiPbmsOkResponse('Lấy chính sách giá thành công', pricingPolicyExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.pricing.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo chính sách giá' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    vehicleTypeId: ids.vehicleTypeId,
    basePrice: 5000,
    baseHours: 1,
    extraHourPrice: 3000,
    nightSurcharge: 2000,
    effectiveDate: '2026-09-01T00:00:00.000Z',
  })
  @ApiPbmsOkResponse('Tạo chính sách giá thành công', pricingPolicyExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.pricing.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật chính sách giá' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    policyId: ids.policyId,
    vehicleTypeId: ids.vehicleTypeId,
    basePrice: 5000,
    baseHours: 1,
    extraHourPrice: 3000,
    nightSurcharge: 2000,
    effectiveDate: '2026-09-01T00:00:00.000Z',
    status: 'Active',
  })
  @ApiPbmsOkResponse('Cập nhật chính sách giá thành công', pricingPolicyExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.pricing.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa chính sách giá' })
  @ApiPbmsOkResponse('Xóa chính sách giá thành công', null)
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
  @ApiPbmsOkResponse('Lấy danh sách gói thuê bao thành công', [packageExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.packages.getAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết gói thuê bao' })
  @ApiPbmsOkResponse('Lấy gói thuê bao thành công', packageExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.packages.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Tạo gói thuê bao' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    vehicleTypeId: ids.vehicleTypeId,
    packageName: 'Gói tháng xe máy',
    durationMonths: 1,
    price: 300000,
    requireFixedSlot: true,
    description: 'Thuê bao tháng, ưu tiên ô cố định',
  })
  @ApiPbmsOkResponse('Tạo gói thuê bao thành công', packageExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.packages.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Put(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật gói thuê bao' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    packageName: 'Gói tháng xe máy',
    durationMonths: 1,
    price: 300000,
    requireFixedSlot: true,
    description: 'Thuê bao tháng, ưu tiên ô cố định',
    status: 'Active',
  })
  @ApiPbmsOkResponse('Cập nhật gói thuê bao thành công', packageExample)
  update(@Param('id') id: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.packages.update(id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa gói thuê bao' })
  @ApiPbmsOkResponse('Xóa gói thuê bao thành công', null)
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.packages.remove(id);
  }
}
