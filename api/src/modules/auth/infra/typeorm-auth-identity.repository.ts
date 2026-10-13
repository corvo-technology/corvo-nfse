import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthIdentity, AuthIdentityProvider } from '../domain/auth-identity';
import { IAuthIdentityRepository } from '../domain/auth-identity.repository';
import { AuthIdentityOrmEntity } from './auth-identity.orm-entity';

@Injectable()
export class TypeOrmAuthIdentityRepository implements IAuthIdentityRepository {
  constructor(
    @InjectRepository(AuthIdentityOrmEntity)
    private readonly repo: Repository<AuthIdentityOrmEntity>,
  ) {}

  async findById(id: string): Promise<AuthIdentity | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? this.toDomain(orm) : null;
  }

  async findByUserId(userId: string): Promise<AuthIdentity[]> {
    const orms = await this.repo.find({ where: { authUserId: userId } });
    return orms.map((o) => this.toDomain(o));
  }

  async findByEmail(email: string): Promise<AuthIdentity | null> {
    const orm = await this.repo.findOne({ where: { email } });
    return orm ? this.toDomain(orm) : null;
  }

  async findByProviderAndEmail(
    provider: AuthIdentityProvider,
    email: string,
  ): Promise<AuthIdentity | null> {
    const orm = await this.repo.findOne({ where: { provider, email } });
    return orm ? this.toDomain(orm) : null;
  }

  async findByProviderAndProviderUserId(
    provider: AuthIdentityProvider,
    providerUserId: string,
  ): Promise<AuthIdentity | null> {
    const orm = await this.repo.findOne({
      where: { provider, providerUserId },
    });
    return orm ? this.toDomain(orm) : null;
  }

  async save(identity: AuthIdentity): Promise<AuthIdentity> {
    const orm = this.repo.create(this.toOrm(identity));
    const saved = await this.repo.save(orm);
    return this.toDomain(saved);
  }

  async update(identity: AuthIdentity): Promise<AuthIdentity> {
    const persistence = identity.toPersistence();
    await this.repo.update(identity.id, {
      emailVerified: persistence.emailVerified,
      name: persistence.name,
      avatarUrl: persistence.avatarUrl,
      email: persistence.email,
    });
    return identity;
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  private toDomain(orm: AuthIdentityOrmEntity): AuthIdentity {
    return AuthIdentity.fromPersistence({
      id: orm.id,
      authUserId: orm.authUserId,
      provider: orm.provider as AuthIdentityProvider,
      providerUserId: orm.providerUserId ?? null,
      email: orm.email,
      emailVerified: orm.emailVerified,
      name: orm.name ?? null,
      avatarUrl: orm.avatarUrl ?? null,
      linkedAt: orm.linkedAt,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  private toOrm(identity: AuthIdentity): Partial<AuthIdentityOrmEntity> {
    const s = identity.toPersistence();
    return {
      id: s.id,
      authUserId: s.authUserId,
      provider: s.provider,
      providerUserId: s.providerUserId,
      email: s.email,
      emailVerified: s.emailVerified,
      name: s.name,
      avatarUrl: s.avatarUrl,
    };
  }
}
