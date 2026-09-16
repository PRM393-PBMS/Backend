import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({ example: 'Thao tác thực hiện thành công' })
  readonly message!: string;

  @ApiProperty({ example: true })
  readonly success!: boolean;
}
