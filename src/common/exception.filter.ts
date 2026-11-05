import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { classifyError, logFailure, requestContext } from './errors';

@Catch()
export class BackendExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const info = classifyError(error);
    const requestId = requestContext.getStore()?.requestId ?? randomUUID();
    logFailure(error);
    response.setHeader('X-Request-Id', requestId);
    if (
      info.status === 429 &&
      'details' in info &&
      info.details &&
      typeof info.details === 'object' &&
      'retryAfterSeconds' in info.details
    )
      response.setHeader('Retry-After', String(info.details.retryAfterSeconds));
    const webhook = request.path === '/api/payments/payos-webhook';
    response.status(info.status).json({
      statusCode: info.status,
      message: info.message,
      isSuccess: false,
      ...(webhook ? {} : { result: null }),
      errorCode: info.code,
      requestId,
      ...('details' in info && info.details ? { details: info.details } : {}),
    });
  }
}
