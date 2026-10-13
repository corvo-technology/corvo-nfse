export type CacheOptions = {
  ttlSeconds?: number;
};

export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPattern(pattern: string): Promise<number>;
  remember<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<T>;
}
