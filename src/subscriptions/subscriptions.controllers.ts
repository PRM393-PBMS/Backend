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
  register(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.subscriptions.register(userId, dto, true);
  }

  @Post()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Manager tạo gói tháng' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.subscriptions.createForUser(dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Gói tháng của tôi' })
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.subscriptions.getMine(userId);
  }

  @Get('user/:userId')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Gói tháng theo người dùng' })
  getByUser(@Param('userId') userId: string): Promise<PbmsResponseDto> {
    return this.subscriptions.getByUser(userId);
  }

  @Get()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Danh sách gói tháng' })
  getAll(): Promise<PbmsResponseDto> {
    return this.subscriptions.getAll();
  }

  @Post('payment/:subscriptionId')
  @ApiOperation({ summary: 'Tạo lại thanh toán gói tháng' })
  createPayment(
    @Param('subscriptionId') subscriptionId: string,
    @GetPbmsUserId() userId: string,
  ): Promise<PbmsResponseDto> {
    return this.subscriptions.createPayment(subscriptionId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết gói tháng' })
  getById(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.subscriptions.getById(id, userId, role);
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: 'Hủy gói tháng' })
  cancel(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.subscriptions.cancel(id, userId, role);
  }

  @Put(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật gói tháng' })
  update(@Param('id') id: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.subscriptions.update(id, dto);
  }

  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa gói tháng' })
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
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Gia hạn trực tiếp' })
  directRenew(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.renewals.directRenew(dto);
  }

  @Post(':id/renew')
  @ApiOperation({ summary: 'Tạo thanh toán gia hạn' })
  renew(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.renewals.renew(id, userId, dto);
  }

  @Get(':id/renewals')
  @ApiOperation({ summary: 'Lịch sử gia hạn theo gói' })
  getBySubscription(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.renewals.getBySubscription(id, userId, role);
  }

  @Get()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Danh sách gia hạn' })
  getAll(): Promise<PbmsResponseDto> {
    return this.renewals.getAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết gia hạn' })
  getById(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.renewals.getById(id, userId, role);
  }

  @Put()
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Cập nhật gia hạn' })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.renewals.update(dto);
  }

  @Delete(':id')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Xóa gia hạn' })
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
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Gửi yêu cầu đổi biển số' })
  create(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.requests.create(userId, dto);
  }

  @Get('my-requests')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Yêu cầu đổi biển số của tôi' })
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.requests.getMine(userId);
  }

  @Get('change-vehicle')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Danh sách yêu cầu đổi biển số' })
  getAll(): Promise<PbmsResponseDto> {
    return this.requests.getAll();
  }

  @Put('change-vehicle/:id/approve')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Duyệt đổi biển số' })
  approve(@Param('id') id: string, @GetPbmsUserId() staffId: string): Promise<PbmsResponseDto> {
    return this.requests.approve(id, staffId);
  }

  @Put('change-vehicle/:id/reject')
  @PbmsRoles('Manager')
  @ApiOperation({ summary: 'Từ chối đổi biển số' })
  reject(
    @Param('id') id: string,
    @GetPbmsUserId() staffId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.requests.reject(id, staffId, dto);
  }

  @Get('change-vehicle/:id')
  @ApiOperation({ summary: 'Chi tiết yêu cầu đổi biển số' })
  getById(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.requests.getById(id, userId, role.trim().toLowerCase() === 'manager');
  }

  @Put('change-vehicle/:id')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Cập nhật yêu cầu đổi biển số' })
  update(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.requests.update(id, userId, dto);
  }

  @Delete('change-vehicle/:id')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Xóa yêu cầu đổi biển số' })
  remove(@Param('id') id: string, @GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.requests.remove(id, userId);
  }
}
