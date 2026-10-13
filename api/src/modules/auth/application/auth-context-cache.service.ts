import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_PORT } from '@/infra/redis/redis.constants';
import type { CachePort } from '@/infra/redis/cache.port';
import { AuthContext } from '../auth-context';
import { recordAuthContextCacheEvent } from '@/modules/security/observability/security.metrics';

export const AUTH_CONTEXT_CACHE_TTL_SECONDS = 300;
const AUTH_CONTEXT_CACHE_VERSION = 'v2';

@Injectable()
export class AuthContextCacheService {
  private readonly logger = new Logger(AuthContextCacheService.name);

  constructor(@Inject(CACHE_PORT) private readonly cache: CachePort) {}

  async get(
    authUserId: string,
    productKey: string,
    activeTenantId?: string,
  ): Promise<AuthContext | null> {
    try {
      const context = await this.cache.get<AuthContext>(
        this.key(authUserId, productKey, activeTenantId),
      );
      recordAuthContextCacheEvent(context ? 'hit' : 'miss');
      return context;
    } catch (error) {
      recordAuthContextCacheEvent('error', 'get');
      this.logFailure('get', error);
      return null;
    }
  }

  async set(
    authUserId: string,
    productKey: string,
    activeTenantId: string | undefined,
    context: AuthContext,
  ): Promise<void> {
    try {
      await this.cache.set(
        this.key(authUserId, productKey, activeTenantId),
        context,
        { ttlSeconds: AUTH_CONTEXT_CACHE_TTL_SECONDS },
      );
      recordAuthContextCacheEvent('set');
    } catch (error) {
      recordAuthContextCacheEvent('error', 'set');
      this.logFailure('set', error);
    }
  }

  async invalidateUser(authUserId: string): Promise<void> {
    try {
      await this.cache.deleteByPattern(
        `auth-context:${AUTH_CONTEXT_CACHE_VERSION}:${authUserId}:*`,
      );
      recordAuthContextCacheEvent('invalidate');
    } catch (error) {
      recordAuthContextCacheEvent('error', 'invalidate');
      this.logFailure('invalidate_user', error);
    }
  }

  async invalidateTenantUsers(authUserIds: string[]): Promise<void> {
    await Promise.all(
      [...new Set(authUserIds)].map((authUserId) =>
        this.invalidateUser(authUserId),
      ),
    );
  }

  private key(
    authUserId: string,
    productKey: string,
    activeTenantId?: string,
  ): string {
    return `auth-context:${AUTH_CONTEXT_CACHE_VERSION}:${authUserId}:${productKey}:${activeTenantId ?? 'default'}`;
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.warn({
      event: 'auth_context_cache_failed',
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
