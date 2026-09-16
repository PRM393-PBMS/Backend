import { Injectable } from '@nestjs/common';

interface OtpEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

/**
 * Bộ nhớ OTP trong process (10 phút, mất khi restart).
 */
@Injectable()
export class OtpStoreService {
  private readonly store = new Map<string, OtpEntry<unknown>>();

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
