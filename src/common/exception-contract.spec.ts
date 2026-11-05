import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { BackendExceptionFilter } from './exception.filter';
import { InputValidationInterceptor } from './input-validation.interceptor';
import { AppError } from './errors';
import { PbmsResponseDto } from './dto/pbms-response.dto';
import { FinancialIdempotencyInterceptor } from './idempotency.interceptor';
import { of, lastValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { createHmac } from 'node:crypto';

@Controller('api/probe')
class ProbeController {
  @Get('unknown') fail() {
    throw new Error('secret_password_or_sql');
  }
  @Get('missing') missing() {
    throw new AppError(404, 'PROBE_MISSING', 'Không tìm thấy dữ liệu');
  }
  @Get('fk') fk() {
    throw new Prisma.PrismaClientKnownRequestError('secret prisma arguments', {
      code: 'P2003',
      clientVersion: '6.4.1',
    });
  }
  @Get('list') list() {
    return PbmsResponseDto.ok('Danh sách', []);
  }
  @Post(':id') save(@Param('id') id: string, @Body() _body: unknown) {
    return PbmsResponseDto.ok('OK', { id });
  }
}
describe('PBMS exception HTTP contract', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: APP_FILTER, useClass: BackendExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: InputValidationInterceptor },
      ],
    }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('hides unexpected internal errors and returns requestId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/unknown')
      .expect(500);
    expect(res.body).toMatchObject({
      isSuccess: false,
      errorCode: 'INTERNAL_ERROR',
      result: null,
    });
    expect(res.body.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
  it('maps FK conflicts without leaking Prisma arguments', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe/fk')
      .expect(409);
    expect(res.body.errorCode).toBe('RELATION_CONFLICT');
  });
  it('preserves not-found and successful empty lists', async () => {
    await request(app.getHttpServer()).get('/api/probe/missing').expect(404);
    const res = await request(app.getHttpServer())
      .get('/api/probe/list')
      .expect(200);
    expect(res.body.result).toEqual([]);
  });
  it('rejects malformed UUID and invalid numeric body before service execution', async () => {
    await request(app.getHttpServer())
      .post('/api/probe/not-a-uuid')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/probe/550e8400-e29b-41d4-a716-446655440000')
      .send({ price: 'abc' })
      .expect(400);
  });
});

describe('Financial Idempotency-Key', () => {
  it('replays completed results and rejects a key reused with another payload', async () => {
    let row: any;
    const db = {
      idempotencyRecord: {
        create: jest.fn(({ data }) => {
          if (row) throw new Error('unique');
          row = data;
          return Promise.resolve(row);
        }),
        findUnique: jest.fn(() => Promise.resolve(row)),
        update: jest.fn(({ data }) => {
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
      },
    };
    const interceptor = new FinancialIdempotencyInterceptor(
      db as unknown as PrismaService,
    );
    const req = {
      method: 'POST',
      path: '/api/Reservation',
      user: { sub: 'u1' },
      headers: { 'idempotency-key': 'stable' },
      body: { vehicleId: 'v1' },
    };
    const response = { status: jest.fn() };
    const context: any = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => response,
      }),
    };
    const next = {
      handle: jest.fn(() =>
        of(PbmsResponseDto.ok('Created', { reservationId: 'r1' }, 201)),
      ),
    };
    await lastValueFrom(interceptor.intercept(context, next));
    const replay: any = await lastValueFrom(
      interceptor.intercept(context, next),
    );
    expect(replay.result.reservationId).toBe('r1');
    expect(next.handle).toHaveBeenCalledTimes(1);
    req.body.vehicleId = 'v2';
    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('PayOS webhook verification', () => {
  afterEach(() => {
    delete process.env.PAYOS_CHECKSUM_KEY;
    delete process.env.PAYOS_CLIENT_ID;
    delete process.env.PAYOS_API_KEY;
  });
  it('accepts a canonical HMAC and rejects mutation', () => {
    process.env.PAYOS_CLIENT_ID = 'test';
    process.env.PAYOS_API_KEY = 'test';
    process.env.PAYOS_CHECKSUM_KEY = 'test-key';
    const payos = new PayosService({} as PrismaService);
    const data = { orderCode: 123, amount: 1000, description: 'Test' };
    const signature = createHmac('sha256', 'test-key')
      .update('amount=1000&description=Test&orderCode=123')
      .digest('hex');
    expect(() => payos.verifyWebhook({ data, signature })).not.toThrow();
    expect(() =>
      payos.verifyWebhook({ data: { ...data, amount: 1 }, signature }),
    ).toThrow(AppError);
  });
});
