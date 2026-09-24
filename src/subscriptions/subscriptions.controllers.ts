import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsRole } from '../auth/common/decorators/get-pbms-role.decorator';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import {
  ids,
  renewalExample,
  subscriptionExample,
  subscriptionPaymentExample,
  vehicleChangeExample,
} from '../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { MonthlySubscriptionsService } from './monthly-subscriptions.service';
import { SubscriptionRenewalsService } from './subscription-renewals.service';
import { VehicleChangeRequestsService } from './vehicle-change-requests.service';

@ApiTags('PBMS MonthlySubscription')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/MonthlySubscription')
export class MonthlySubscriptionsController {
  constructor(private readonly subscriptions: MonthlySubscriptionsService) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký gói tháng (tạo thanh toán PayOS)' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    packageId: ids.packageId,
    licensePlate: '59A12345',
    vehicleTypeId: ids.vehicleTypeId,
    fixedSlotId: ids.slotId,
  })
  @ApiPbmsOkResponse('Tạo đăng ký gói thành công', subscriptionPaymentExample, 201)
  register(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.subscriptions.register(userId, dto, true);
  }

  @Post()
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Manager tạo gói tháng' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    userId: ids.userId,
    packageId: ids.packageId,
    licensePlate: '59A12345',
    vehicleTypeId: ids.vehicleTypeId,
  })
  @ApiPbmsOkResponse('Tạo đăng ký gói thành công', subscriptionPaymentExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.subscriptions.createForUser(dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Gói tháng của tôi' })
  @ApiPbmsOkResponse('Lấy gói tháng của tôi thành công', [subscriptionExample])
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.subscriptions.getMine(userId);
  }

  @Get('user/:userId')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Gói tháng theo người dùng' })
  @ApiPbmsOkResponse('Lấy gói tháng theo người dùng thành công', [subscriptionExample])
  getByUser(@Param('userId') userId: string): Promise<PbmsResponseDto> {
    return this.subscriptions.getByUser(userId);
  }

  @Get()
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Danh sách gói tháng' })
  @ApiPbmsOkResponse('Lấy danh sách gói tháng thành công', [subscriptionExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.subscriptions.getAll();
  }

  @Post('payment/:subscriptionId')
  @ApiOperation({ summary: 'Tạo lại thanh toán gói tháng' })
  @ApiPbmsOkResponse('Tạo thanh toán gói thành công', subscriptionPaymentExample)
  createPayment(
    @Param('subscriptionId') subscriptionId: string,
    @GetPbmsUserId() userId: string,
  ): Promise<PbmsResponseDto> {
    return this.subscriptions.createPayment(subscriptionId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết gói tháng' })
  @ApiPbmsOkResponse('Lấy gói tháng thành công', subscriptionExample)
  getById(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.subscriptions.getById(id, userId, role);
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: 'Hủy gói tháng' })
  @ApiPbmsOkResponse('Hủy gói tháng thành công', null)
  cancel(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.subscriptions.cancel(id, userId, role);
  }

  @Put(':id')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Cập nhật gói tháng' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    licensePlate: '59A12345',
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: '2026-12-01T00:00:00.000Z',
    status: 'Active',
    fixedSlotId: ids.slotId,
  })
  @ApiPbmsOkResponse('Cập nhật gói tháng thành công', subscriptionExample)
  update(@Param('id') id: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.subscriptions.update(id, dto);
  }

  @Delete(':id')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Xóa gói tháng' })
  @ApiPbmsOkResponse('Xóa gói tháng thành công', null)
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.subscriptions.remove(id);
  }
}

@ApiTags('PBMS SubscriptionRenewal')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/SubscriptionRenewal')
export class SubscriptionRenewalsController {
  constructor(private readonly renewals: SubscriptionRenewalsService) {}

  @Post('direct-renew')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Gia hạn trực tiếp' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    subscriptionId: ids.subscriptionId,
    months: 1,
    amount: 300000,
  })
  @ApiPbmsOkResponse('Gia hạn trực tiếp thành công', renewalExample, 201)
  directRenew(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.renewals.directRenew(dto);
  }

  @Post(':id/renew')
  @ApiOperation({ summary: 'Tạo thanh toán gia hạn' })
  @ApiPbmsBodyExample(PbmsBodyDto, { months: 1 })
  @ApiPbmsOkResponse('Tạo thanh toán gia hạn thành công', subscriptionPaymentExample)
  renew(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.renewals.renew(id, userId, dto);
  }

  @Get(':id/renewals')
  @ApiOperation({ summary: 'Lịch sử gia hạn theo gói' })
  @ApiPbmsOkResponse('Lấy lịch sử gia hạn thành công', [renewalExample])
  getBySubscription(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.renewals.getBySubscription(id, userId, role);
  }

  @Get()
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Danh sách gia hạn' })
  @ApiPbmsOkResponse('Lấy danh sách gia hạn thành công', [renewalExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.renewals.getAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết gia hạn' })
  @ApiPbmsOkResponse('Lấy gia hạn thành công', renewalExample)
  getById(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.renewals.getById(id, userId, role);
  }

  @Put()
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Cập nhật gia hạn' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    renewalId: ids.renewalId,
    amount: 300000,
    renewalDate: '2026-09-15T08:30:00.000Z',
  })
  @ApiPbmsOkResponse('Cập nhật gia hạn thành công', renewalExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.renewals.update(dto);
  }

  @Delete(':id')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Xóa gia hạn' })
  @ApiPbmsOkResponse('Xóa gia hạn thành công', null)
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.renewals.remove(id);
  }
}

@ApiTags('PBMS VehicleChangeRequest')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/VehicleChangeRequest')
export class VehicleChangeRequestsController {
  constructor(private readonly requests: VehicleChangeRequestsService) {}

  @Post('change-vehicle')
  @PbmsRoles('customer')
  @ApiOperation({ summary: 'Gửi yêu cầu đổi biển số' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    subscriptionId: ids.subscriptionId,
    newLicensePlate: '59B67890',
    reason: 'Đổi xe mới',
  })
  @ApiPbmsOkResponse('Đã gửi yêu cầu đổi xe thành công', vehicleChangeExample, 201)
  create(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.requests.create(userId, dto);
  }

  @Get('my-requests')
  @PbmsRoles('customer')
  @ApiOperation({ summary: 'Yêu cầu đổi biển số của tôi' })
  @ApiPbmsOkResponse('Lấy yêu cầu đổi xe của tôi thành công', [vehicleChangeExample])
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.requests.getMine(userId);
  }

  @Get('change-vehicle')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Danh sách yêu cầu đổi biển số' })
  @ApiPbmsOkResponse('Lấy danh sách yêu cầu đổi xe thành công', [vehicleChangeExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.requests.getAll();
  }

  @Put('change-vehicle/:id/approve')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Duyệt đổi biển số' })
  @ApiPbmsOkResponse('Duyệt yêu cầu đổi xe thành công', { ...vehicleChangeExample, status: 'Approved' })
  approve(@Param('id') id: string, @GetPbmsUserId() staffId: string): Promise<PbmsResponseDto> {
    return this.requests.approve(id, staffId);
  }

  @Put('change-vehicle/:id/reject')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Từ chối đổi biển số' })
  @ApiPbmsBodyExample(PbmsBodyDto, { reason: 'Biển số không khớp giấy tờ' })
  @ApiPbmsOkResponse('Từ chối yêu cầu đổi xe thành công', {
    ...vehicleChangeExample,
    status: 'Rejected',
    rejectionReason: 'Biển số không khớp giấy tờ',
  })
  reject(
    @Param('id') id: string,
    @GetPbmsUserId() staffId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.requests.reject(id, staffId, dto);
  }

  @Get('change-vehicle/:id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu đổi biển số' })
  @ApiPbmsOkResponse('Lấy yêu cầu đổi xe thành công', vehicleChangeExample)
  getById(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.requests.getById(id, userId, role.trim().toLowerCase() === 'manager');
  }

  @Put('change-vehicle/:id')
  @PbmsRoles('customer')
  @ApiOperation({ summary: 'Cập nhật yêu cầu đổi biển số' })
  @ApiPbmsBodyExample(PbmsBodyDto, { newLicensePlate: '59B67890', reason: 'Đổi xe mới' })
  @ApiPbmsOkResponse('Cập nhật yêu cầu đổi xe thành công', vehicleChangeExample)
  update(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.requests.update(id, userId, dto);
  }

  @Delete('change-vehicle/:id')
  @PbmsRoles('customer')
  @ApiOperation({ summary: 'Xóa yêu cầu đổi biển số' })
  @ApiPbmsOkResponse('Xóa yêu cầu đổi xe thành công', null)
  remove(@Param('id') id: string, @GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.requests.remove(id, userId);
  }
}
