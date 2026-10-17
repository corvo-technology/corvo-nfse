import { Injectable } from '@nestjs/common';
import type { QueryDeepPartialEntity } from 'typeorm';
import { AuthUserOrmEntity } from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { IAuthUserAttributionRepository } from '../domain/auth-user-attribution.repository';

@Injectable()
export class TypeOrmAuthUserAttributionRepository implements IAuthUserAttributionRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  async recordIfAbsent(
    authUserId: string,
    attribution: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await this.db
      .repository(AuthUserOrmEntity)
      .createQueryBuilder()
      .update(AuthUserOrmEntity)
      .set({
        signupAttribution: attribution,
      } as QueryDeepPartialEntity<AuthUserOrmEntity>)
      .where('id = :authUserId', { authUserId })
      .andWhere('signup_attribution IS NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
