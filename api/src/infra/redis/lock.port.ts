export type AcquiredLock = {
  key: string;
  token: string;
  ttlMs: number;
};

export type LockOptions = {
  ttlMs: number;
};

export type RenewingLockOptions = LockOptions & {
  renewIntervalMs: number;
  acquireTimeoutMs?: number;
};

export interface LockPort {
  acquire(key: string, options: LockOptions): Promise<AcquiredLock | null>;
  extend(lock: AcquiredLock, ttlMs?: number): Promise<boolean>;
  release(lock: AcquiredLock): Promise<boolean>;
  withLock<T>(
    key: string,
    options: LockOptions,
    callback: () => Promise<T>,
  ): Promise<T>;
  withRenewingLock<T>(
    key: string,
    options: RenewingLockOptions,
    callback: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
}
