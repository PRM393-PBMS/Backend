import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Mật khẩu hiện tại của tài khoản',
    example: 'Backend@2026',
  })
  @IsNotEmpty({ message: 'Mật khẩu cũ không được để trống' })
  @IsString({ message: 'Mật khẩu cũ phải là chuỗi ký tự' })
  readonly oldPassword!: string;

  @ApiProperty({
    description: 'Mật khẩu mới (tối thiểu 8 ký tự, có đủ chữ hoa, thường, số và ký tự đặc biệt)',
    example: 'NewSecurePass@2026',
    minLength: 8,
    maxLength: 64,
  })
  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @MinLength(8, { message: 'Mật khẩu mới phải có tối thiểu 8 ký tự' })
  @MaxLength(64, { message: 'Mật khẩu mới không vượt quá 64 ký tự' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&^#()_+={}[\]:;"'<>,.?/~`|\\-])[A-Za-z\d@$!%*?&^#()_+={}[\]:;"'<>,.?/~`|\\-]{8,}$/,
    {
      message:
        'Mật khẩu mới phải chứa ít nhất 1 chữ cái in hoa, 1 chữ thường, 1 chữ số và 1 ký tự đặc biệt',
    },
  )
  readonly newPassword!: string;
}
