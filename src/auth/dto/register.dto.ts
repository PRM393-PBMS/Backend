import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Địa chỉ email người dùng (duy nhất trong hệ thống)',
    example: 'engineer@prm393.fpt.edu.vn',
    format: 'email',
  })
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Định dạng email không hợp lệ' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  readonly email!: string;

  @ApiProperty({
    description: 'Mật khẩu độ dài 8-64 ký tự, gồm ít nhất 1 chữ hoa, 1 chữ thường, 1 số và 1 ký tự đặc biệt',
    example: 'Backend@2026',
    minLength: 8,
    maxLength: 64,
  })
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(8, { message: 'Mật khẩu phải có độ dài tối thiểu 8 ký tự' })
  @MaxLength(64, { message: 'Mật khẩu không được vượt quá 64 ký tự' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&^#()_+={}[\]:;"'<>,.?/~`|\\-])[A-Za-z\d@$!%*?&^#()_+={}[\]:;"'<>,.?/~`|\\-]{8,}$/,
    {
      message:
        'Mật khẩu phải chứa ít nhất 1 chữ cái in hoa, 1 chữ thường, 1 chữ số và 1 ký tự đặc biệt',
    },
  )
  readonly password!: string;

  @ApiProperty({
    description: 'Họ và tên đệm của người dùng',
    example: 'Huỳnh Dũng',
    maxLength: 50,
  })
  @IsNotEmpty({ message: 'Họ và tên đệm không được để trống' })
  @IsString({ message: 'Họ và tên đệm phải là chuỗi ký tự' })
  @MaxLength(50, { message: 'Họ và tên đệm tối đa 50 ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  readonly firstName!: string;

  @ApiProperty({
    description: 'Tên của người dùng',
    example: 'Phong',
    maxLength: 50,
  })
  @IsNotEmpty({ message: 'Tên không được để trống' })
  @IsString({ message: 'Tên phải là chuỗi ký tự' })
  @MaxLength(50, { message: 'Tên tối đa 50 ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  readonly lastName!: string;
}
