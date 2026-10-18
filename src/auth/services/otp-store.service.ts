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
    this.client = createClient({ url });
    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis OTP error: ${error.message}`);
    });
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.client.set(`pbms:otp:${key}`, JSON.stringify(value), {
      PX: ttlMs,
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const redisKey = `pbms:otp:${key}`;
    const value = await this.client.get(redisKey);
    if (value === null) {
      return undefined;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      await this.client.del(redisKey);
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(`pbms:otp:${key}`);
  }
}
