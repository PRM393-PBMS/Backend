import { Body, Controller, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import {
  ids,
  walletExample,
  walletSpendExample,
  walletTopUpExample,
  walletTransactionExample,
} from '../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { WalletsService } from './wallets.service';

@ApiTags('PBMS Wallet')
@ApiBearerAuth('JWT-auth')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/wallet')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @ApiOperation({
    summary: 'Mở ví của tôi (tạo nếu chưa có)',
    description: [
      'JWT bắt buộc. Không body. User mới chưa có ví (`walletId` null trên profile/login) — gọi API này để tạo hàng `wallets` rồi lấy UUID.',
      '`result`: `walletId`, `userId`, `walletBalance` (0 khi mới tạo).',
      'Lỗi: 401 `Vui lòng đăng nhập`; 404 `Không tìm thấy người dùng`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Mở ví thành công', { walletId: ids.walletId, userId: ids.userId, walletBalance: 0 })
  ensureMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.wallets.ensureMine(userId);
  }

  @Get(':walletId')
  @ApiParam({ name: 'walletId', description: 'UUID ví (từ profile/login `walletId` hoặc POST `/api/wallet`)' })
  @ApiOperation({
    summary: 'Số dư ví và lịch sử giao dịch gần đây theo WalletId',
    description: [
      'JWT bắt buộc. Path `walletId` phải thuộc user trong token.',
      '`result`: `walletId`, `userId`, `walletBalance` (VND hiện tại), `transactions` (tối đa 200, mới nhất trước). Mỗi phần tử: `walletTransactionId`, `direction` (`Credit`|`Debit`), `type` (`TopUp`|`SubscriptionFee`), `amount` (âm khi Debit), `absoluteAmount`, `balanceAfter`, `createdAt`, `paymentId`, `subscriptionId` (null nếu nạp), `paymentMethod`, `paymentType`, `orderCode`, `packageName`, `licensePlate`, `description`.',
      'Nạp PayOS chưa webhook thì chưa có dòng Credit và `walletBalance` chưa tăng.',
      'Lỗi: 401 `Vui lòng đăng nhập`; 400 WalletId không hợp lệ; 404 `Không tìm thấy ví`; 403 `Bạn không sở hữu ví này`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy thông tin ví thành công', walletExample)
  getById(
    @GetPbmsUserId() userId: string,
    @Param('walletId') walletId: string,
  ): Promise<PbmsResponseDto> {
    return this.wallets.getById(userId, walletId);
  }

  @Get(':walletId/transactions')
  @ApiParam({ name: 'walletId', description: 'UUID ví thuộc user hiện tại' })
  @ApiOperation({
    summary: 'Toàn bộ lịch sử ví (nạp + chi) theo WalletId',
    description: [
      'JWT bắt buộc. `result` là mảng (tối đa 200) cùng schema từng phần tử như GET `/api/wallet/{walletId}` → `transactions`. Gồm `TopUp` và `SubscriptionFee`. Không query phân trang.',
      'Lỗi: 401 / 400 / 403 / 404 như GET `/api/wallet/{walletId}`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy lịch sử ví thành công', [walletTransactionExample, walletSpendExample])
  listTransactions(
    @GetPbmsUserId() userId: string,
    @Param('walletId') walletId: string,
  ): Promise<PbmsResponseDto> {
    return this.wallets.listTransactions(userId, walletId);
  }

  @Get(':walletId/top-ups')
  @ApiParam({ name: 'walletId', description: 'UUID ví thuộc user hiện tại' })
  @ApiOperation({
    summary: 'Lịch sử nạp ví (Credit / PayOS) theo WalletId',
    description: [
      'JWT bắt buộc. `result` chỉ `type=TopUp` / `direction=Credit` sau webhook PayOS thành công. Payment Pending không nằm ở đây.',
      'Lỗi: 401 / 400 / 403 / 404 như GET `/api/wallet/{walletId}`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy lịch sử nạp ví thành công', [walletTransactionExample])
  listTopUps(
    @GetPbmsUserId() userId: string,
    @Param('walletId') walletId: string,
  ): Promise<PbmsResponseDto> {
    return this.wallets.listTopUps(userId, walletId);
  }

  @Get(':walletId/spends')
  @ApiParam({ name: 'walletId', description: 'UUID ví thuộc user hiện tại' })
  @ApiOperation({
    summary: 'Lịch sử chi ví (Debit / mua gói tháng) theo WalletId',
    description: [
      'JWT bắt buộc. `result` chỉ `type=SubscriptionFee` / `direction=Debit` khi thanh toán gói bằng `paymentMethod=Wallet`. Thường có `subscriptionId`, `packageName`, `licensePlate`.',
      'Lỗi: 401 / 400 / 403 / 404 như GET `/api/wallet/{walletId}`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy lịch sử chi ví thành công', [walletSpendExample])
  listSpends(
    @GetPbmsUserId() userId: string,
    @Param('walletId') walletId: string,
  ): Promise<PbmsResponseDto> {
    return this.wallets.listSpends(userId, walletId);
  }

  @Post(':walletId/top-up')
  @ApiParam({ name: 'walletId', description: 'UUID ví thuộc user hiện tại' })
  @ApiOperation({
    summary: 'Nạp ví qua PayOS (mở paymentUrl) theo WalletId',
    description: [
      'JWT bắt buộc. Path `walletId` phải thuộc JWT. Tạo Payment `paymentType=WalletTopUp`, `paymentMethod=PayOS`, `paymentStatus=Pending`. **Chưa cộng** số dư ví. FE mở `paymentUrl`; số dư tăng sau `POST /api/payments/payos-webhook`.',
      '`result` 201: `walletId`, `paymentId`, `paymentMethod`, `paymentType`, `amount`, `walletBalance` (số dư hiện tại), `paymentLinkId`, `paymentUrl`, `orderCode`.',
      'Lỗi: thiếu `amount`; `amount` không phải số nguyên 2000–10000000 VND; 401; 400 WalletId; 403 không phải chủ ví; 404 ví; 500 khi PayOS tạo link thất bại (payment → Failed).',
    ].join('\n\n'),
  })
  @ApiPbmsBodyExample(
    PbmsBodyDto,
    { amount: 100000 },
    '`amount` (bắt buộc): số nguyên VND từ 2000 đến 10000000. Không gửi `paymentMethod` — nạp ví luôn PayOS.',
  )
  @ApiPbmsOkResponse('Tạo liên kết nạp ví thành công', walletTopUpExample, 201)
  topUp(
    @GetPbmsUserId() userId: string,
    @Param('walletId') walletId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.wallets.topUp(userId, walletId, dto);
  }
}
