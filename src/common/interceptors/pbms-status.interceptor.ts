import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { PbmsResponseDto } from '../dto/pbms-response.dto';

/**
 * Gán HTTP status = envelope.statusCode.
 * Chỉ dùng trên controller PBMS `/api/*`.
 */
@Injectable()
export class PbmsStatusInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap((body: unknown) => {
        if (body instanceof PbmsResponseDto && typeof body.statusCode === 'number') {
          res.status(body.statusCode);
        }
      }),
    );
  }
}
