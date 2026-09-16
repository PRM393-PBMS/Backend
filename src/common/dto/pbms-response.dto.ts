import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Envelope HTTP chuẩn PBMS: statusCode, message, isSuccess, result. JSON camelCase.
 */
export class PbmsResponseDto<T = unknown> {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiPropertyOptional({ example: 'Đăng nhập thành công' })
  message: string | null;

  @ApiProperty({ example: true })
  isSuccess: boolean;

  @ApiPropertyOptional()
  result: T | null;

  constructor(
    message: string,
    statusCode: number,
    isSuccess = false,
    result: T | null = null,
  ) {
    this.message = message;
    this.statusCode = statusCode;
    this.isSuccess = isSuccess;
    this.result = result;
  }

  static ok<T>(message: string, result: T | null = null, statusCode = 200): PbmsResponseDto<T> {
    return new PbmsResponseDto(message, statusCode, true, result);
  }

  static fail(message: string, statusCode = 400): PbmsResponseDto {
    return new PbmsResponseDto(message, statusCode, false);
  }
}
