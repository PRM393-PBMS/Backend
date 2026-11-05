import { classifyError, logFailure, requestContext } from '../errors';
import { userErrorMessage } from '../user-message';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Envelope HTTP chuẩn PBMS: statusCode, message, isSuccess, result. JSON camelCase.
 */
export class PbmsResponseDto<T = unknown> {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiPropertyOptional() errorCode?: string;
  @ApiPropertyOptional() requestId?: string;
  @ApiPropertyOptional() details?: unknown;

  @ApiPropertyOptional({ example: 'Đăng nhập thành công' })
  message: string | null;

  @ApiProperty({ example: true })
  isSuccess: boolean;

  @ApiPropertyOptional({
    description:
      'Payload theo từng endpoint; Example Value trên operation có object đầy đủ, không `{}`.',
    nullable: true,
    example: {
      userId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      userName: 'fonfon',
      email: 'fonHocPRM393@gmail.com',
    },
  })
  result: T | null;

  constructor(
    message: string,
    statusCode: number,
    isSuccess = false,
    result: T | null = null,
  ) {
    this.message = isSuccess ? message : userErrorMessage(message, statusCode);
    this.statusCode = statusCode;
    this.isSuccess = isSuccess;
    this.result = result;
    if (!isSuccess) {
      this.errorCode = `HTTP_${statusCode}`;
      this.requestId = requestContext.getStore()?.requestId;
    }
  }

  static ok<T>(
    message: string,
    result: T | null = null,
    statusCode = 200,
  ): PbmsResponseDto<T> {
    return new PbmsResponseDto(message, statusCode, true, result);
  }

  static fromError(error: unknown): PbmsResponseDto {
    const info = classifyError(error);
    logFailure(error);
    const result = new PbmsResponseDto(info.message, info.status);
    result.message = info.message;
    result.errorCode = info.code;
    if ('details' in info) result.details = info.details;
    return result;
  }

  static fail(message: string, statusCode = 400): PbmsResponseDto {
    return new PbmsResponseDto(message, statusCode, false);
  }
}
