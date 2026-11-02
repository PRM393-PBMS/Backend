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
    vehicleId: ids.vehicleId,
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

  @Get('availability')
  @ApiOperation({
    summary: 'Suất đặt trước còn lại của một bãi',
    description: '`parkingId` bãi khách chọn; `time` giờ vào dự kiến (ISO, mặc định 30 phút nữa). Trả hạn mức, số suất đang giữ quanh giờ đó, số còn lại và tiền cọc.',
  })
  availability(@Query('parkingId') parkingId?: string, @Query('time') time?: string): Promise<PbmsResponseDto> {
    return this.reservations.availability(parkingId, time);
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
  @PbmsRoles('manager', 'staff')
  @ApiOperation({
    summary: 'Danh sách đặt chỗ',
    description: '`date` là ngày theo giờ Việt Nam (YYYY-MM-DD); `parkingId` lọc theo bãi; `status` lọc trạng thái.',
  })
  @ApiPbmsOkResponse('Lấy danh sách đặt chỗ thành công', [reservationExample])
  getAll(
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('parkingId') parkingId?: string,
  ): Promise<PbmsResponseDto> {
    return this.reservations.getAll(status, date, parkingId);
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
    @GetPbmsUserId() userId: string,
    @Body() body: unknown,
  ): Promise<PbmsResponseDto> {
    return this.reservations.changeTime(reservationId, userId, body);
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
  @PbmsRoles('manager', 'staff')
  @ApiOperation({
    summary: 'Nhân viên huỷ đơn hoặc đánh dấu khách không đến',
    description:
      'Chỉ: Pending → Cancelled; Confirmed/Modified → Cancelled (hoàn 100% cọc vào ví) hoặc NoShow (sau giờ hẹn, không hoàn cọc). Vào bãi / hoàn tất do cổng ghi.',
  })
  @ApiPbmsBodyExample(PbmsBodyDto, { status: 'NoShow' })
  @ApiPbmsOkResponse('Cập nhật trạng thái đặt chỗ thành công', {
    ...reservationExample,
    status: 'NoShow',
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
