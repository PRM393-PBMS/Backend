import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient } from 'redis';

@Injectable()
export class OtpStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OtpStoreService.name);

  private readonly client = createClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  });

  constructor() {
    this.client.on('error', (error: Error) => {
      this.logger.error(error.message);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.client.set(`pbms:otp:${key}`, JSON.stringify(value), {
      PX: ttlMs,
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.client.get(`pbms:otp:${key}`);

    return value === null ? undefined : (JSON.parse(value) as T);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(`pbms:otp:${key}`);
  }
}