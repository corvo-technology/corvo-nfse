import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { Decimal } from '@/shared/types/money';
import { TypeOrmTransactionContext } from './typeorm-transaction-context';
import { instrumentTypeOrmRepository } from './typeorm-telemetry';

export function decimalToString(value: Decimal): string {
  return value.toFixed();
}

export function nullableDecimalToString(
  value: Decimal | null | undefined,
): string | null {
  return value ? decimalToString(value) : null;
}

export function decimalFromDb(value: string): Decimal {
  return new Decimal(value);
}

export function nullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

export function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

@Injectable()
export class TypeOrmRepositoryHelper {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactionContext: TypeOrmTransactionContext,
  ) {}

  manager(): EntityManager {
    return this.transactionContext.getManager() ?? this.dataSource.manager;
  }

  repository<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
    return instrumentTypeOrmRepository(this.manager().getRepository(entity));
  }
}
