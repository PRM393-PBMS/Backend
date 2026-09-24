import { Body, Controller, Get, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import {
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

  @Get()
  @ApiOperation({
    summary: 'Số dư ví và lịch sử giao dịch gần đây',
    description: [
      'JWT bắt buộc (`Authorization: Bearer`). Không body.',
      '`result`: `userId`, `walletBalance` (VND hiện tại), `transactions` (tối đa 200, mới nhất trước). Mỗi phần tử: `walletTransactionId`, `direction` (`Credit`|`Debit`), `type` (`TopUp`|`SubscriptionFee`), `amount` (âm khi Debit), `absoluteAmount`, `balanceAfter`, `createdAt`, `paymentId`, `subscriptionId` (null nếu nạp), `paymentMethod`, `paymentType`, `orderCode`, `packageName`, `licensePlate`, `description`.',
      'Nạp PayOS chưa webhook thì chưa có dòng Credit và `walletBalance` chưa tăng.',
      'Lỗi: 401 `Vui lòng đăng nhập`; 404 `Không tìm thấy người dùng`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy thông tin ví thành công', walletExample)
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.wallets.getMine(userId);
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'Toàn bộ lịch sử ví (nạp + chi) của tôi',
    description: [
      'JWT bắt buộc. `result` là mảng (tối đa 200) cùng schema từng phần tử như GET `/api/wallet` → `transactions`. Gồm `TopUp` và `SubscriptionFee`. Không query phân trang.',
      'Lỗi: 401 `Vui lòng đăng nhập`; 404 `Không tìm thấy người dùng`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy lịch sử ví thành công', [walletTransactionExample, walletSpendExample])
  listTransactions(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.wallets.listTransactions(userId);
  }

  @Get('top-ups')
  @ApiOperation({
    summary: 'Lịch sử nạp ví (Credit / PayOS)',
    description: [
      'JWT bắt buộc. `result` chỉ `type=TopUp` / `direction=Credit` sau webhook PayOS thành công. Payment Pending không nằm ở đây.',
      'Lỗi: 401 / 404 như GET `/api/wallet`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy lịch sử nạp ví thành công', [walletTransactionExample])
  listTopUps(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.wallets.listTopUps(userId);
  }

  @Get('spends')
  @ApiOperation({
    summary: 'Lịch sử chi ví (Debit / mua gói tháng)',
    description: [
      'JWT bắt buộc. `result` chỉ `type=SubscriptionFee` / `direction=Debit` khi thanh toán gói bằng `paymentMethod=Wallet`. Thường có `subscriptionId`, `packageName`, `licensePlate`.',
      'Lỗi: 401 / 404 như GET `/api/wallet`.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy lịch sử chi ví thành công', [walletSpendExample])
  listSpends(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.wallets.listSpends(userId);
  }

  @Post('top-up')
  @ApiOperation({
    summary: 'Nạp ví qua PayOS (mở paymentUrl)',
    description: [
      'JWT bắt buộc. Tạo Payment `paymentType=WalletTopUp`, `paymentMethod=PayOS`, `paymentStatus=Pending`. **Chưa cộng** `walletBalance`. FE mở `paymentUrl`; số dư tăng sau `POST /api/payments/payos-webhook`.',
      '`result` 201: `paymentId`, `paymentMethod`, `paymentType`, `amount`, `walletBalance` (số dư hiện tại), `paymentLinkId`, `paymentUrl`, `orderCode`.',
      'Lỗi: thiếu `amount`; `amount` không phải số nguyên 2000–10000000 VND; 401; 404 user; 500 khi PayOS tạo link thất bại (payment → Failed).',
    ].join('\n\n'),
  })
  @ApiPbmsBodyExample(
    PbmsBodyDto,
    { amount: 100000 },
    '`amount` (bắt buộc): số nguyên VND từ 2000 đến 10000000. Không gửi `paymentMethod` — nạp ví luôn PayOS.',
  )
  @ApiPbmsOkResponse('Tạo liên kết nạp ví thành công', walletTopUpExample, 201)
  topUp(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.wallets.topUp(userId, dto);
  }
}
