import { HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { userErrorMessage } from './user-message';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
export class AppError extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super({ statusCode: status, errorCode: code, message, details }, status);
  }
}
export function classifyError(error: unknown) {
  const info = classifyInternalError(error);
  return {
    ...info,
    message: userErrorMessage(info.message, info.status, info.code),
  };
}
function classifyInternalError(error: unknown) {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    const value =
      typeof body === 'string'
        ? { message: body }
        : (body as Record<string, unknown>);
    const status = error.getStatus();
    return {
      status,
      code: String(value.errorCode ?? `HTTP_${status}`),
      message: Array.isArray(value.message)
        ? 'Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.'
        : value.message,
      details:
        value.details ??
        (Array.isArray(value.message) ? value.message : undefined),
    };
  }
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    ['entity.parse.failed', 'entity.too.large'].includes(String(error.type))
  )
    return {
      status: error.type === 'entity.too.large' ? 413 : 400,
      code:
        error.type === 'entity.too.large' ? 'BODY_TOO_LARGE' : 'INVALID_JSON',
      message:
        error.type === 'entity.too.large'
          ? 'Dữ liệu gửi lên quá lớn'
          : 'Body JSON không hợp lệ',
    };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const code = error.code;
    if (code === 'P2002')
      return {
        status: 409,
        code: 'RESOURCE_CONFLICT',
        message: 'Dữ liệu đã tồn tại hoặc đang được xử lý',
      };
    if (code === 'P2004')
      return {
        status: 409,
        code: 'DOMAIN_CONSTRAINT',
        message:
          'Thay đổi vi phạm điều kiện nghiệp vụ hoặc dữ liệu đang được sử dụng',
      };
    if (code === 'P2003')
      return {
        status: 409,
        code: 'RELATION_CONFLICT',
        message: 'Dữ liệu liên quan không tồn tại hoặc đang được sử dụng',
      };
    if (code === 'P2025')
      return {
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        message: 'Không tìm thấy dữ liệu yêu cầu',
      };
    if (['P2034', 'P2028'].includes(code))
      return {
        status: 409,
        code: 'CONCURRENT_OPERATION',
        message: 'Dữ liệu vừa thay đổi, vui lòng tải lại trạng thái',
      };
    if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code))
      return {
        status: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Cơ sở dữ liệu tạm thời chưa sẵn sàng',
      };
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    /23514/.test(error.message)
  )
    return {
      status: 409,
      code: 'DOMAIN_CONSTRAINT',
      message:
        'Thay đổi vi phạm điều kiện nghiệp vụ hoặc dữ liệu đang được sử dụng',
    };
  if (error instanceof Prisma.PrismaClientInitializationError)
    return {
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Cơ sở dữ liệu tạm thời chưa sẵn sàng',
    };
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['ECONNREFUSED', 'ETIMEDOUT', 'ENOSPC', 'EACCES', 'ECONNRESET'].includes(
      String(error.code),
    )
  )
    return {
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'Dịch vụ phụ thuộc hoặc bộ lưu trữ tạm thời chưa sẵn sàng',
    };
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Hệ thống gặp lỗi, vui lòng thử lại sau',
  };
}
export function logFailure(error: unknown): void {
  // Log classification and stack locations, never raw Prisma arguments/provider bodies.
  const info = classifyError(error);
  const frames =
    error instanceof Error
      ? error.stack
          ?.split('\n')
          .slice(1)
          .filter((x) => /^\s+at /.test(x))
          .slice(0, 8)
          .join('\n')
      : '';
  new Logger('BackendException').error({
    requestId: requestContext.getStore()?.requestId,
    errorCode: info.code,
    type: error instanceof Error ? error.name : 'Unknown',
    frames,
  });
}
