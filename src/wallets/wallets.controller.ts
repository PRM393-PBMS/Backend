import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
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
import { CreateWalletAdjustmentDto } from './dto/create-wallet-adjustment.dto';

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
      '`result`: `walletId`, `userId`, `walletBalance` (tổng khả dụng = `cashBalance` + `bonusBalance` còn hạn), `cashBalance` (tiền nạp), `bonusBalance` (khuyến mãi còn hạn), `bonusExpiresAt`, `transactions` (tối đa 200, mới nhất trước). Mỗi phần tử: `walletTransactionId`, `direction` (`Credit`|`Debit`), `type` (`TOP_UP`|`DEBIT`|`REFUND`|`ADJUSTMENT`), `bucket` (`CASH`|`BONUS`), `referenceType` (`WalletTopUp`|`SubscriptionFee`|`SubscriptionRenewal`|`ParkingFee`|`Adjustment`), `referenceId`, `amount` (âm khi Debit), `absoluteAmount`, `balanceAfter`, `createdAt`, `paymentId`, `subscriptionId` (null nếu nạp), `paymentMethod`, `paymentType`, `orderCode`, `packageName`, `licensePlate`, `description`.',
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
      'JWT bắt buộc. `result` là mảng (tối đa 200) cùng schema từng phần tử như GET `/api/wallet/{walletId}` → `transactions`. Gồm mọi dòng sổ cái của cả hai ngăn: `TOP_UP` (nạp), `DEBIT` (chi), `REFUND` (hoàn), `ADJUSTMENT` (điều chỉnh khuyến mãi). Không query phân trang.',
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
      'JWT bắt buộc. `result` chỉ `type=TOP_UP` / `direction=Credit` sau webhook PayOS thành công. Payment Pending không nằm ở đây.',
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
      'JWT bắt buộc. `result` chỉ `type=DEBIT` / `direction=Debit` (mua/gia hạn gói, phí gửi xe bằng ví). Một lần thanh toán có thể có 2 dòng: `bucket=BONUS` (trừ trước) và `bucket=CASH`.',
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

  @Post(':walletId/adjustments')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('admin', 'manager')
  @ApiParam({ name: 'walletId', description: 'UUID ví của khách cần điều chỉnh' })
  @ApiOperation({
    summary: 'Admin/Manager điều chỉnh ngăn khuyến mãi (BONUS) của ví',
    description: [
      'JWT role Admin/Manager. Chỉ đổi `bonusBalance`; ngăn tiền nạp (`cashBalance`) không bao giờ bị sửa qua API này.',
      'Body: `amount` (số nguyên VND khác 0, âm = thu hồi), `reasonType` (`PROMOTION`|`COMPENSATION`|`CORRECTION`|`EXPIRED`), `note` (≥ 5 ký tự), `expiryDays` (tuỳ chọn, đặt lại hạn dùng ngăn khuyến mãi).',
      'Ghi một dòng sổ cái `type=ADJUSTMENT`, `bucket=BONUS` và một bản ghi `wallet_adjustment_logs` (người thao tác lấy từ JWT), rồi báo khách.',
      '`result` 201: `adjustmentId`, `reasonType`, `amount`, `note`, `walletId`, `userId`, `walletBalance`, `cashBalance`, `bonusBalance`, `bonusExpiresAt`.',
      'Lỗi: 400 dữ liệu không hợp lệ / thu hồi vượt số dư khuyến mãi; 401; 403 không phải Admin/Manager; 404 ví.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse(
    'Điều chỉnh ví khuyến mãi thành công',
    {
      adjustmentId: ids.walletId,
      reasonType: 'COMPENSATION',
      amount: 50000,
      note: 'Bồi thường sự cố barie ngày 20/10',
      walletId: ids.walletId,
      userId: ids.userId,
      walletBalance: 150000,
      cashBalance: 100000,
      bonusBalance: 50000,
      bonusExpiresAt: '2026-11-21T00:00:00.000Z',
    },
    201,
  )
  adjustBonus(
    @GetPbmsUserId() adminId: string,
    @Param('walletId') walletId: string,
    @Body() dto: CreateWalletAdjustmentDto,
  ): Promise<PbmsResponseDto> {
    return this.wallets.adjustBonusBalance(walletId, adminId, dto);
  }
}
