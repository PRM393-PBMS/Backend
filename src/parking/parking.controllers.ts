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
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Xem phí tạm tính phiên của tôi' })
  myFee(@Param('id') id: string, @GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.operations.getMyFeePreview(id, userId);
  }

  @Get('my/:id/checkout-payment')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Xem thanh toán checkout phiên của tôi' })
  myCheckout(@Param('id') id: string, @GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.operations.getMyCheckoutPayment(id, userId);
  }

  @Get('my')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Phiên gửi xe của tôi' })
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.sessions.getMine(userId);
  }

  @Get()
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Danh sách phiên gửi xe' })
  getAll(): Promise<PbmsResponseDto> {
    return this.sessions.getAll();
  }

  @Get(':id')
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Chi tiết phiên gửi xe' })
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.sessions.getById(id);
  }

  @Post()
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Tạo phiên gửi xe' })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.sessions.create(dto);
  }

  @Put()
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Cập nhật phiên gửi xe' })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.sessions.update(dto);
  }

  @Delete(':id')
  @PbmsRoles('Manager', 'Staff')
  @ApiOperation({ summary: 'Xóa phiên gửi xe' })
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
  availability(
    @Query('vehicleTypeId') vehicleTypeId?: string,
    @Query('floorKeyword') floorKeyword?: string,
  ): Promise<PbmsResponseDto> {
    return this.operations.availability(vehicleTypeId, floorKeyword);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
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
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('upload-and-decode-qr')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload ảnh và giải mã QR' })
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
  @PbmsRoles('Staff', 'Manager')
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
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('resolve-qr-payload')
  @ApiOperation({ summary: 'Giải mã payload QR' })
  resolveQr(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.operations.resolveQrPayload(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('check-in')
  @ApiOperation({ summary: 'Check-in xe' })
  checkIn(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.operations.checkIn(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('check-out')
  @ApiOperation({ summary: 'Check-out xe' })
  checkOut(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.operations.checkOut(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get('check-out/payment/:paymentId')
  @ApiOperation({ summary: 'Trạng thái thanh toán checkout' })
  checkoutPayment(@Param('paymentId') paymentId: string): Promise<PbmsResponseDto> {
    return this.operations.getCheckoutPayment(paymentId);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('check-out/payment/:paymentId/confirm-cash')
  @ApiOperation({ summary: 'Xác nhận checkout tiền mặt' })
  confirmCash(@Param('paymentId') paymentId: string): Promise<PbmsResponseDto> {
    return this.operations.confirmCash(paymentId);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post('check-out/payment/:paymentId/cancel')
  @ApiOperation({ summary: 'Hủy checkout' })
  cancelCheckout(@Param('paymentId') paymentId: string): Promise<PbmsResponseDto> {
    return this.operations.cancelCheckout(paymentId);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('Staff', 'Manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get('fee-preview/:sessionId')
  @ApiOperation({ summary: 'Phí tạm tính theo phiên' })
  feePreview(@Param('sessionId') sessionId: string): Promise<PbmsResponseDto> {
    return this.operations.getFeePreview(sessionId);
  }
}
