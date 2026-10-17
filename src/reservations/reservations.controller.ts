import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
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
import { ids, reservationExample, subscriptionPaymentExample } from '../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { ReservationsService } from './reservations.service';

@ApiTags('PBMS Reservations')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo đặt chỗ và thanh toán đặt cọc' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    vehicleTypeId: ids.vehicleTypeId,
    expectedEntryTime: '2026-09-18T09:00:00.000Z',
  })
  @ApiPbmsOkResponse('Reservation created successfully', {
    reservation: reservationExample,
    payment: subscriptionPaymentExample,
  })
  create(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.reservations.create(userId, dto);
  }

  @Get('my-reservations')
  @ApiOperation({ summary: 'Đặt chỗ của tôi' })
  @ApiPbmsOkResponse('Lấy danh sách đặt chỗ thành công', [reservationExample])
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.reservations.getMine(userId);
  }

  @Get('check-payment-status/:orderCode')
  @ApiOperation({ summary: 'Kiểm tra thanh toán theo orderCode' })
  @ApiPbmsOkResponse('Lấy trạng thái thanh toán thành công', {
    orderCode: 'PBMS-20260917-1001',
    paymentStatus: 'Success',
  })
  checkPayment(@Param('orderCode') orderCode: string): Promise<PbmsResponseDto> {
    return this.reservations.checkPaymentStatus(orderCode);
  }

  @Get()
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Danh sách đặt chỗ' })
  @ApiPbmsOkResponse('Lấy danh sách đặt chỗ thành công', [reservationExample])
  getAll(@Query('status') status?: string, @Query('date') date?: string): Promise<PbmsResponseDto> {
    return this.reservations.getAll(status, date);
  }

  @Post(':id/recreate-payment')
  @ApiOperation({ summary: 'Tạo lại liên kết thanh toán đặt chỗ' })
  @ApiPbmsOkResponse('Tạo lại liên kết thanh toán thành công', subscriptionPaymentExample)
  recreate(@Param('id') id: string, @GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.reservations.recreatePayment(id, userId);
  }

  @Put(':reservationId/change-time')
  @ApiOperation({ summary: 'Đổi giờ đặt chỗ' })
  @ApiPbmsBodyExample(PbmsBodyDto, { newExpectedTime: '2026-09-18T10:30:00.000Z' })
  @ApiPbmsOkResponse('Đổi giờ đặt chỗ thành công', reservationExample)
  changeTime(
    @Param('reservationId') reservationId: string,
    @Body() body: unknown,
  ): Promise<PbmsResponseDto> {
    return this.reservations.changeTime(reservationId, body);
  }

  @Put(':reservationId/cancel')
  @ApiOperation({ summary: 'Hủy đặt chỗ' })
  @ApiPbmsOkResponse('Hủy đặt chỗ thành công', null)
  cancel(
    @Param('reservationId') reservationId: string,
    @GetPbmsUserId() userId: string,
  ): Promise<PbmsResponseDto> {
    return this.reservations.cancel(reservationId, userId);
  }

  @Put(':reservationId/status')
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Cập nhật trạng thái đặt chỗ' })
  @ApiPbmsBodyExample(PbmsBodyDto, { status: 'CheckedIn' })
  @ApiPbmsOkResponse('Cập nhật trạng thái đặt chỗ thành công', {
    ...reservationExample,
    status: 'CheckedIn',
  })
  updateStatus(
    @Param('reservationId') reservationId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.reservations.updateStatus(reservationId, dto);
  }

  @Get(':reservationId')
  @ApiOperation({ summary: 'Chi tiết đặt chỗ' })
  @ApiPbmsOkResponse('Lấy thông tin đặt chỗ thành công', reservationExample)
  getById(
    @Param('reservationId') reservationId: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.reservations.getById(reservationId, userId, role);
  }
}
