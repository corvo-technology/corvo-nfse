import { CursorQuery } from '@/shared/http/pagination';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { ApiKey, ApiKeyEnvironment, ApiKeyScope } from '../domain/api-key';
import { IApiKeyRepository } from '../domain/api-key.repository';
import { AuthContext } from '../auth-context';

const API_KEY_TOKEN_BYTE_LENGTH = 20;
const API_KEY_LOOKUP_TOKEN_HEX_LENGTH = 12;
const API_KEY_FORMAT = /^corvo_(live|test)_([a-f0-9]{40})$/;

export type CreateApiKeyInput = {
  name: string;
  environment: ApiKeyEnvironment;
  scope: ApiKeyScope;
  expiresAt?: Date;
};

export type CreatedApiKeyResult = {
  apiKey: ApiKey;
  /** The raw key string - shown once to the caller, never stored in plain text. */
  plaintext: string;
};

@Injectable()
export class ApiKeyService {
  listPage(authContext: AuthContext, options: CursorQuery) {
    return this.apiKeyRepo.listPage(authContext.activeTenantId, options);
  }

  constructor(private readonly apiKeyRepo: IApiKeyRepository) {}

  async create(
    authContext: AuthContext,
    input: CreateApiKeyInput,
  ): Promise<CreatedApiKeyResult> {
    const random = randomBytes(API_KEY_TOKEN_BYTE_LENGTH).toString('hex');
    const prefix = this.buildPrefix(input.environment, random);
    const plaintext = `corvo_${input.environment}_${random}`;
    const keyHash = await argon2.hash(plaintext);

    const apiKey: ApiKey = {
      id: crypto.randomUUID(),
      tenantId: authContext.activeTenantId,
      name: input.name,
      environment: input.environment,
      keyPrefix: prefix,
      keyHash,
      scope: input.scope,
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    };

    const saved = await this.apiKeyRepo.save(
      apiKey,
      authContext.activeTenantId,
    );
    return { apiKey: saved, plaintext };
  }

  async list(authContext: AuthContext): Promise<ApiKey[]> {
    return this.apiKeyRepo.findByTenantId(authContext.activeTenantId);
  }

  async revoke(authContext: AuthContext, apiKeyId: string): Promise<void> {
    const apiKey = await this.apiKeyRepo.findByIdAndTenantId(
      apiKeyId,
      authContext.activeTenantId,
    );
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    await this.apiKeyRepo.remove(apiKey, authContext.activeTenantId);
  }

  async delete(tenantId: string, apiKeyId: string): Promise<void> {
    const apiKey = await this.apiKeyRepo.findByIdAndTenantId(
      apiKeyId,
      tenantId,
    );
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    await this.apiKeyRepo.remove(apiKey, tenantId);
  }

  /**
   * Validate a raw API key string and return the corresponding domain ApiKey.
   * Throws if the key is invalid, expired, or not found.
   */
  async validate(rawKey: string): Promise<ApiKey> {
    const prefix = this.prefixFromRawKey(rawKey);
    if (!prefix) {
      throw new UnauthorizedException('Invalid API key');
    }
    const apiKey = await this.apiKeyRepo.findByKeyPrefix(prefix);
    if (!apiKey || apiKey.environment !== API_KEY_FORMAT.exec(rawKey)?.[1]) {
      throw new UnauthorizedException('Invalid API key');
    }

    const isValid = await argon2.verify(apiKey.keyHash, rawKey);
    if (!isValid) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    return apiKey;
  }

  async touchLastUsed(apiKeyId: string, tenantId: string): Promise<void> {
    await this.apiKeyRepo.touchLastUsed(apiKeyId, tenantId, new Date());
  }

  private buildPrefix(environment: ApiKeyEnvironment, token: string): string {
    return `corvo_${environment}_${token.substring(0, API_KEY_LOOKUP_TOKEN_HEX_LENGTH)}`;
  }

  private prefixFromRawKey(rawKey: string): string | null {
    const match = API_KEY_FORMAT.exec(rawKey);
    if (!match) return null;

    const [, environment, token] = match;
    return this.buildPrefix(environment as ApiKeyEnvironment, token);
  }
}
