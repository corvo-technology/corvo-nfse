import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import {
  effectiveProfilesOn,
  type CompanyFiscalProfile,
  type ProfileReviewStatus,
  type SimplesApuracao,
  type TaxRegimeKind,
} from '../domain/fiscal-profile';
import type {
  IFiscalProfileRepository,
  NewFiscalProfile,
} from '../domain/fiscal-profile.repository';
import { CompanyFiscalProfileOrmEntity } from './company-fiscal-profile.orm-entity';
import { CompanyOrmEntity } from './company.orm-entity';

@Injectable()
export class TypeOrmCompanyFiscalProfileRepository implements IFiscalProfileRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionContext,
  ) {}

  private profiles() {
    const manager = this.transactions.getManager() ?? this.dataSource.manager;
    return manager.getRepository(CompanyFiscalProfileOrmEntity);
  }

  async findEffective(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyFiscalProfile | null> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.profiles().findBy({ companyId, tenantId });
      return effectiveProfilesOn(rows.map(toDomain), date)[0] ?? null;
    });
  }

  async findOpen(
    companyId: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.profiles().findOneBy({
        companyId,
        tenantId,
        validUntil: IsNull(),
      });
      return row ? toDomain(row) : null;
    });
  }

  async findOpenByCompanyIds(
    companyIds: string[],
    tenantId: string,
  ): Promise<CompanyFiscalProfile[]> {
    if (companyIds.length === 0) return [];
    return runWithTenant(tenantId, async () => {
      const rows = await this.profiles().findBy({
        companyId: In(companyIds),
        tenantId,
        validUntil: IsNull(),
      });
      return rows.map(toDomain);
    });
  }

  async list(
    companyId: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile[]> {
    return runWithTenant(tenantId, async () => {
      const rows = await this.profiles().find({
        where: { companyId, tenantId },
        order: { validFrom: 'DESC' },
      });
      return rows.map(toDomain);
    });
  }

  async findById(
    id: string,
    tenantId: string,
  ): Promise<CompanyFiscalProfile | null> {
    return runWithTenant(tenantId, async () => {
      const row = await this.profiles().findOneBy({ id, tenantId });
      return row ? toDomain(row) : null;
    });
  }

  async markApproved(
    id: string,
    tenantId: string,
    reviewedBy: string,
    at: Date,
  ): Promise<CompanyFiscalProfile> {
    return runWithTenant(tenantId, async () => {
      const profiles = this.profiles();
      const row = await profiles.findOneBy({ id, tenantId });
      if (!row) throw new NotFoundException('Fiscal profile not found');
      return toDomain(
        await profiles.save({
          ...row,
          reviewStatus: 'approved',
          reviewedBy,
          reviewedAt: at,
        }),
      );
    });
  }

  async append(
    companyId: string,
    tenantId: string,
    input: NewFiscalProfile,
  ): Promise<CompanyFiscalProfile> {
    return runWithTenant(tenantId, () =>
      this.dataSource.transaction(async (manager) => {
        // Serializes concurrent changes to the same company's history.
        const company = await manager.getRepository(CompanyOrmEntity).findOne({
          select: { id: true },
          where: { id: companyId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!company) throw new NotFoundException('Company not found');

        const profiles = manager.getRepository(CompanyFiscalProfileOrmEntity);
        const history = await profiles.find({
          where: { companyId },
          order: { validFrom: 'ASC' },
        });
        const earliest = history[0];
        const open = history.find((profile) => !profile.validUntil);
        // A company existed before it was registered: a start before the whole
        // history is a closed profile that ends where the history began.
        const retroactive = earliest && input.validFrom < earliest.validFrom;

        if (open && !retroactive) {
          if (input.validFrom < open.validFrom)
            throw new FiscalValidationError([
              {
                field: 'validFrom',
                code: 'invalid',
                message:
                  'validFrom cannot be before the current fiscal profile start',
              },
            ]);
          if (input.validFrom === open.validFrom) {
            if (open.reviewStatus === 'approved')
              throw new ConflictException('profile_validity_conflict');
            return toDomain(
              await profiles.save({ ...open, ...fieldsOf(input) }),
            );
          }
          await profiles.update(open.id, { validUntil: input.validFrom });
        }
        return toDomain(
          await profiles.save({
            ...fieldsOf(input),
            tenantId,
            companyId,
            validFrom: input.validFrom,
            validUntil: retroactive ? earliest.validFrom : null,
          }),
        );
      }),
    );
  }
}

/** What a vigência carries, except when it starts. */
function fieldsOf(input: NewFiscalProfile) {
  return {
    taxRegime: input.taxRegime,
    simpleNational: input.simpleNational,
    specialTaxRegime: input.specialTaxRegime,
    ibsCbsRegularOption: input.ibsCbsRegularOption,
    ibsCbsRegularFrom: input.ibsCbsRegularFrom,
    simplesIssRate: input.simplesIssRate,
    simplesApuracao: input.simplesApuracao ?? null,
    source: input.source,
    reviewStatus: input.reviewStatus,
    reviewedBy: input.reviewedBy,
    reviewedAt: input.reviewStatus === 'approved' ? new Date() : null,
  };
}

function toDomain(row: CompanyFiscalProfileOrmEntity): CompanyFiscalProfile {
  return {
    id: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    taxRegime: row.taxRegime as TaxRegimeKind,
    simpleNational: row.simpleNational,
    specialTaxRegime: row.specialTaxRegime ?? null,
    ibsCbsRegularOption: row.ibsCbsRegularOption,
    ibsCbsRegularFrom: row.ibsCbsRegularFrom ?? null,
    simplesIssRate: row.simplesIssRate ?? null,
    simplesApuracao: (row.simplesApuracao ?? null) as SimplesApuracao | null,
    validFrom: row.validFrom,
    validUntil: row.validUntil ?? null,
    source: row.source,
    reviewStatus: row.reviewStatus as ProfileReviewStatus,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt ?? null,
    createdAt: row.createdAt,
  };
}
