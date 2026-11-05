import { AppError } from '../../common/errors';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class OtpStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OtpStoreService.name);
  private client!: RedisClientType;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      throw new Error('Thiếu REDIS_URL: Redis là bắt buộc để lưu OTP');
    }
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) =>
          retries < 3
            ? 100 * (retries + 1)
            : new Error('Redis connection unavailable'),
      },
    });
    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis OTP unavailable: ${error.name}`);
    });
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  private async command<T>(run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new AppError(
                  503,
                  'OTP_STORE_UNAVAILABLE',
                  'Dịch vụ OTP chưa sẵn sàng',
                ),
              ),
            10000,
          );
          timer.unref();
        }),
      ]);
    } catch {
      throw new AppError(
        503,
        'OTP_STORE_UNAVAILABLE',
        'Dịch vụ OTP chưa sẵn sàng',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async throttle(key: string, limit: number, windowMs: number): Promise<void> {
    if (!this.client?.isReady)
      throw new AppError(
        503,
        'OTP_STORE_UNAVAILABLE',
        'Dịch vụ OTP chưa sẵn sàng',
      );
    const count = await this.command(() =>
      this.client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n",
        { keys: ['pbms:otp:limit:' + key], arguments: [String(windowMs)] },
      ),
    );
    if (Number(count) > limit)
      throw new AppError(
        429,
        'OTP_RATE_LIMIT',
        'Quá số lần thử; vui lòng chờ trước khi thử lại',
        { retryAfterSeconds: Math.ceil(windowMs / 1000) },
      );
  }

  async consume(key: string, expected: unknown): Promise<boolean> {
    if (!this.client?.isReady)
      throw new AppError(
        503,
        'OTP_STORE_UNAVAILABLE',
        'Dịch vụ OTP chưa sẵn sàng',
      );
    const result = await this.command(() =>
      this.client.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('DEL',KEYS[1]); return 1; end; return 0",
        { keys: ['pbms:otp:' + key], arguments: [JSON.stringify(expected)] },
      ),
    );
    return Number(result) === 1;
  }

  async ready(): Promise<void> {
    if (!this.client?.isReady)
      throw new AppError(
        503,
        'OTP_STORE_UNAVAILABLE',
        'Dịch vụ OTP chưa sẵn sàng',
      );
    try {
      await this.command(() => this.client.ping());
    } catch {
      throw new AppError(
        503,
        'OTP_STORE_UNAVAILABLE',
        'Dịch vụ OTP chưa sẵn sàng',
      );
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!this.client?.isReady)
      throw new AppError(
        503,
        'OTP_STORE_UNAVAILABLE',
        'Dịch vụ OTP chưa sẵn sàng',
      );
    await this.command(() =>
      this.client.set(`pbms:otp:${key}`, JSON.stringify(value), {
        PX: ttlMs,
      }),
    );
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.client?.isReady)
      throw new AppError(
        503,
        'OTP_STORE_UNAVAILABLE',
        'Dịch vụ OTP chưa sẵn sàng',
      );
    const redisKey = `pbms:otp:${key}`;
    const value = await this.command(() => this.client.get(redisKey));
    if (value === null) {
      return undefined;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      await this.command(() => this.client.del(redisKey));
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.client?.isReady)
      throw new AppError(
        503,
        'OTP_STORE_UNAVAILABLE',
        'Dịch vụ OTP chưa sẵn sàng',
      );
    await this.command(() => this.client.del(`pbms:otp:${key}`));
  }
}
