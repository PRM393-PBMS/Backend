import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../enums/role.enum';

export class UserSummaryDto {
  @ApiProperty({
    description: 'UUID định danh duy nhất của người dùng',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  readonly id!: string;

  @ApiProperty({
    description: 'Địa chỉ email người dùng',
    example: 'fonfon@prm393.fpt.edu.vn',
  })
  readonly email!: string;

  @ApiProperty({
    description: 'Vai trò trong hệ thống',
    enum: Role,
    example: Role.USER,
  })
  readonly role!: Role;

  @ApiProperty({
    description: 'Họ và tên đệm',
    example: 'Huỳnh Dũng',
  })
  readonly firstName!: string | null;

  @ApiProperty({
    description: 'Tên người dùng',
    example: 'Phong',
  })
  readonly lastName!: string | null;
}

export class AuthResponseDto {
  @ApiProperty({
    description: 'JWT Access Token có thời hạn ngắn (15 phút)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  readonly accessToken!: string;

  @ApiProperty({
    description: 'JWT Refresh Token có thời hạn dài (7 ngày)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  readonly refreshToken!: string;

  @ApiProperty({
    description: 'Thông tin hồ sơ tóm tắt của người dùng',
    type: () => UserSummaryDto,
  })
  readonly user!: UserSummaryDto;
}
