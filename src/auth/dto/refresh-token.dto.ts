import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Chuỗi Refresh Token JWT nhận được từ lần login/refresh trước đó',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsNotEmpty({ message: 'Refresh token không được để trống' })
  @IsString({ message: 'Refresh token phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  readonly refreshToken!: string;
}

export class OptionalRefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Refresh Token tùy chọn trong Body nếu không truyền qua Bearer Header',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsString({ message: 'Refresh token phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  readonly refreshToken?: string;
}
