import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdjustmentReasonType } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';

const ADJUSTMENT_LIMIT = 10_000_000;

/** Body điều chỉnh ngăn khuyến mãi (BONUS) của ví. */
export class CreateWalletAdjustmentDto {
  @ApiProperty({
    example: 50000,
    description: 'VND, số nguyên khác 0. Dương = cộng khuyến mãi, âm = thu hồi (không làm âm ngăn BONUS).',
  })
  @IsInt({ message: 'Số tiền điều chỉnh phải là số nguyên VND' })
  @NotEquals(0, { message: 'Số tiền điều chỉnh phải khác 0' })
  @Min(-ADJUSTMENT_LIMIT)
  @Max(ADJUSTMENT_LIMIT)
  amount!: number;

  @ApiProperty({ enum: Object.values(AdjustmentReasonType), example: AdjustmentReasonType.COMPENSATION })
  @IsIn(Object.values(AdjustmentReasonType), { message: 'Loại lý do không hợp lệ' })
  reasonType!: AdjustmentReasonType;

  @ApiProperty({ example: 'Bồi thường sự cố barie ngày 20/10', minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5, { message: 'Ghi chú tối thiểu 5 ký tự' })
  @MaxLength(500)
  note!: string;

  @ApiPropertyOptional({ example: 30, description: 'Số ngày tới khi ngăn khuyến mãi hết hạn (tính từ bây giờ).' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(3650)
  expiryDays?: number;
}
