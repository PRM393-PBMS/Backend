import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { Public } from '../auth/common/decorators/public.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import {
  feeExample,
  ids,
  paymentExample,
  sessionExample,
} from '../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { FilesService } from '../integrations/payos-files.service';
import { ParkingOperationsService } from './parking-operations.service';
import { ParkingSessionsService } from './parking-sessions.service';

function requestBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

@ApiTags('PBMS ParkingSession')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/ParkingSession')
export class ParkingSessionsController {
  constructor(
    private readonly sessions: ParkingSessionsService,
    private readonly operations: ParkingOperationsService,
  ) {}

  @Get('my/:id/fee-preview')
  @PbmsRoles('customer')
  @ApiOperation({ summary: 'Xem phí tạm tính phiên của tôi' })
  @ApiPbmsOkResponse('Tính phí gửi xe tạm tính thành công', feeExample)
  myFee(@Param('id') id: string, @GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.operations.getMyFeePreview(id, userId);
  }

  @Get('my/:id/checkout-payment')
  @PbmsRoles('customer')
  @ApiOperation({ summary: 'Xem thanh toán checkout phiên của tôi' })
  @ApiPbmsOkResponse('Lấy yêu cầu thanh toán checkout thành công', {
    Payment: paymentExample,
    Fee: feeExample,
  })
  myCheckout(@Param('id') id: string, @GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.operations.getMyCheckoutPayment(id, userId);
  }

  @Get('my')
  @PbmsRoles('customer')
  @ApiOperation({ summary: 'Phiên gửi xe của tôi' })
  @ApiPbmsOkResponse('Lấy phiên gửi xe của tôi thành công', [sessionExample])
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.sessions.getMine(userId);
  }

  @Get()
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Danh sách phiên gửi xe' })
  @ApiPbmsOkResponse('Lấy danh sách phiên gửi xe thành công', [sessionExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.sessions.getAll();
  }

  @Get(':id')
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Chi tiết phiên gửi xe' })
  @ApiPbmsOkResponse('Lấy phiên gửi xe thành công', sessionExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.sessions.getById(id);
  }

  @Post()
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Tạo phiên gửi xe' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    licensePlateIn: '59A12345',
    vehicleTypeId: ids.vehicleTypeId,
    entryGateId: ids.gateEntryId,
    driverUserId: ids.userId,
    assignedSlotId: ids.slotId,
    entryTime: '2026-09-17T08:15:00.000Z',
  })
  @ApiPbmsOkResponse('Tạo phiên gửi xe thành công', sessionExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.sessions.create(dto);
  }

  @Put()
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Cập nhật phiên gửi xe' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    sessionId: ids.sessionId,
    licensePlateOut: '59A12345',
    exitGateId: ids.gateExitId,
    exitTime: '2026-09-17T11:45:00.000Z',
    status: 'Completed',
  })
  @ApiPbmsOkResponse('Cập nhật phiên gửi xe thành công', sessionExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.sessions.update(dto);
  }

  @Delete(':id')
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Xóa phiên gửi xe' })
  @ApiPbmsOkResponse('Xóa phiên gửi xe thành công', null)
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.sessions.remove(id);
  }
}

@ApiTags('PBMS ParkingOperation')
@Controller('api/ParkingOperation')
export class ParkingOperationsController {
  constructor(
    private readonly operations: ParkingOperationsService,
    private readonly files: FilesService,
  ) {}

  @Public()
  @UseInterceptors(PbmsStatusInterceptor)
  @Get('availability')
  @ApiOperation({ summary: 'Tình trạng chỗ trống' })
  @ApiPbmsOkResponse('Lấy tình trạng chỗ trống thành công', {
    floors: [{ floorName: 'Tầng B1', available: 33, total: 120, vehicleTypeName: 'Xe máy' }],
  })
  availability(
    @Query('vehicleTypeId') vehicleTypeId?: string,
    @Query('floorKeyword') floorKeyword?: string,
  ): Promise<PbmsResponseDto> {
    return this.operations.availability(vehicleTypeId, floorKeyword);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @Post('upload-and-recognize-plate')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload ảnh và nhận diện biển số' })
  async recognizePlate(
    @UploadedFile() file: import('../common/uploaded-image').UploadedImage,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!file) {
      res.status(400).json({ message: 'Vui lòng gửi file ảnh' });
      return;
    }
    const upload = await this.files.saveUpload(file, requestBaseUrl(req));
    const result = await this.operations.recognizePlate(file, upload.imageUrl);
    const status = result.licensePlate ? 200 : 422;
    res.status(status).json(result);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('upload-and-decode-qr')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload ảnh và giải mã QR' })
  @ApiPbmsOkResponse('Giải mã QR thành công', {
    qrPayload: ids.sessionId,
    imageUrl: 'https://api.example.com/uploads/qr.jpg',
  })
  async decodeQr(
    @UploadedFile() file: import('../common/uploaded-image').UploadedImage,
    @Req() req: Request,
  ): Promise<PbmsResponseDto> {
    if (!file) {
      return PbmsResponseDto.fail('Vui lòng gửi file ảnh');
    }
    const upload = await this.files.saveUpload(file, requestBaseUrl(req));
    return this.operations.decodeQr(file, upload.imageUrl);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload ảnh check-in/out' })
  async uploadImage(
    @UploadedFile() file: import('../common/uploaded-image').UploadedImage,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!file) {
      res.status(400).json({ message: 'Vui lòng gửi file ảnh' });
      return;
    }
    const upload = await this.files.saveUpload(file, requestBaseUrl(req));
    res.status(200).json({ imageUrl: upload.imageUrl });
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('resolve-qr-payload')
  @ApiOperation({ summary: 'Giải mã payload QR' })
  @ApiPbmsBodyExample(PbmsBodyDto, { qrPayload: ids.sessionId })
  @ApiPbmsOkResponse('Giải mã payload QR thành công', {
    sessionId: ids.sessionId,
    licensePlateIn: '59A12345',
  })
  resolveQr(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.operations.resolveQrPayload(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('check-in')
  @ApiOperation({ summary: 'Check-in xe' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    licensePlateIn: '59A12345',
    vehicleTypeId: ids.vehicleTypeId,
    entryGateId: ids.gateEntryId,
    customerType: 'WalkIn',
  })
  @ApiPbmsOkResponse('Check-in xe vãng lai thành công', sessionExample, 201)
  checkIn(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.operations.checkIn(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('check-out')
  @ApiOperation({ summary: 'Check-out xe' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    sessionId: ids.sessionId,
    licensePlateOut: '59A12345',
    exitGateId: ids.gateExitId,
    paymentMethod: 'Cash',
  })
  @ApiPbmsOkResponse('Chờ xác nhận tiền mặt để hoàn tất checkout', {
    Payment: { ...paymentExample, paymentStatus: 'Pending' },
    Fee: feeExample,
  })
  checkOut(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.operations.checkOut(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get('check-out/payment/:paymentId')
  @ApiOperation({ summary: 'Trạng thái thanh toán checkout' })
  @ApiPbmsOkResponse('Lấy trạng thái thanh toán checkout thành công', {
    Payment: paymentExample,
  })
  checkoutPayment(@Param('paymentId') paymentId: string): Promise<PbmsResponseDto> {
    return this.operations.getCheckoutPayment(paymentId);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('check-out/payment/:paymentId/confirm-cash')
  @ApiOperation({ summary: 'Xác nhận checkout tiền mặt' })
  @ApiPbmsOkResponse('Đã nhận tiền mặt và checkout thành công', {
    Session: { ...sessionExample, status: 'Completed', exitTime: '2026-09-17T11:45:00.000Z' },
    Payment: paymentExample,
  })
  confirmCash(@Param('paymentId') paymentId: string): Promise<PbmsResponseDto> {
    return this.operations.confirmCash(paymentId);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('check-out/payment/:paymentId/cancel')
  @ApiOperation({ summary: 'Hủy checkout' })
  @ApiPbmsOkResponse('Đã hủy yêu cầu checkout', { Payment: { ...paymentExample, paymentStatus: 'Cancelled' } })
  cancelCheckout(@Param('paymentId') paymentId: string): Promise<PbmsResponseDto> {
    return this.operations.cancelCheckout(paymentId);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get('fee-preview/:sessionId')
  @ApiOperation({ summary: 'Phí tạm tính theo phiên' })
  @ApiPbmsOkResponse('Tính phí gửi xe tạm tính thành công', feeExample)
  feePreview(@Param('sessionId') sessionId: string): Promise<PbmsResponseDto> {
    return this.operations.getFeePreview(sessionId);
  }
}
