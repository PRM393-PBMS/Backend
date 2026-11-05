import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { from, lastValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from './errors';
import { PbmsResponseDto } from './dto/pbms-response.dto';

function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
@Injectable()
export class FinancialIdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['idempotency-key'];
    if (
      req.method !== 'POST' ||
      !key ||
      !req.user?.sub ||
      !/reservation|subscription|\/prepay|\/top-up|\/renew|\/payment/i.test(
        req.path,
      )
    )
      return next.handle();
    if (typeof key !== 'string' || !/^[\w.-]{1,128}$/.test(key))
      throw new AppError(
        400,
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key không hợp lệ',
      );
    return from(this.run(context, next, key));
  }
  private async run(context: ExecutionContext, next: CallHandler, key: string) {
    const req = context.switchToHttp().getRequest();
    const userId = req.user.sub as string;
    const operation = req.path as string;
    const payloadHash = createHash('sha256')
      .update(canonical(req.body))
      .digest('hex');
    const where = { userId_operation_key: { userId, operation, key } };
    try {
      await this.prisma.idempotencyRecord.create({
        data: { userId, operation, key, payloadHash },
      });
    } catch (error) {
      const record = await this.prisma.idempotencyRecord.findUnique({ where });
      if (!record) throw error;
      if (record.payloadHash !== payloadHash)
        throw new AppError(
          409,
          'IDEMPOTENCY_MISMATCH',
          'Mã yêu cầu đã dùng cho dữ liệu khác',
        );
      if (!record.response)
        throw new AppError(
          409,
          'OPERATION_PENDING',
          'Yêu cầu đang xử lý hoặc chưa xác định kết quả; hãy kiểm tra lịch sử trước khi gửi lại',
        );
      const body = record.response as unknown as PbmsResponseDto;
      context.switchToHttp().getResponse().status(body.statusCode);
      return body;
    }
    const result = await lastValueFrom(next.handle());
    // Persist even a 5xx result: the domain operation may have committed already.
    await this.prisma.idempotencyRecord.update({
      where,
      data: { response: JSON.parse(JSON.stringify(result)) },
    });
    return result;
  }
}
