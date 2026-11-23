import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { runAsPlatformAdminOnTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { TypeOrmTenantRepository } from '@/modules/auth/infra/typeorm-tenant.repository';
import { CreditsService } from '@/modules/credits/application/credits.service';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { accountNotice } from '@/shared/events/account-notice.events';
import {
  PlatformAdminAuditRepository,
  type PlatformAuditEvent,
} from '../infra/platform-admin-audit.repository';
import type { CreditGrantResult } from '../platform-admin.contract';
import type { PlatformAdminActor } from '../platform-admin.guard';

export type CreditGrantInput = {
  amount: number;
  reason: string;
  notifyUser: boolean;
};

/** Customer-facing description: it reaches GET /credits/history, so it stays generic. */
const GRANT_DESCRIPTION = 'Notas cedidas pela Corvo';

function errorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body && 'code' in body)
      return String(body.code);
  }
  return 'INTERNAL_ERROR';
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

@Injectable()
export class PlatformCreditGrantService {
  private readonly logger = new Logger(PlatformCreditGrantService.name);

  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly audit: PlatformAdminAuditRepository,
    private readonly credits: CreditsService,
    private readonly tenants: TypeOrmTenantRepository,
    private readonly eventBus: ApplicationEventBus,
  ) {}

  async grant(
    actor: PlatformAdminActor,
    tenantId: string,
    input: CreditGrantInput,
    idempotencyKey: string,
  ): Promise<CreditGrantResult> {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim().length === 0 ||
      idempotencyKey.length > 200
    )
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency-Key must contain 1 to 200 characters',
      });

    let result: CreditGrantResult;
    try {
      result = await runAsPlatformAdminOnTenant(tenantId, async () => {
        const tenant = await this.tenants.findById(tenantId);
        if (!tenant)
          throw new NotFoundException({
            code: 'RESOURCE_NOT_FOUND',
            message: 'Resource not found',
          });
        try {
          return await this.uow.execute(() =>
            this.attempt(actor, tenantId, input, idempotencyKey),
          );
        } catch (error) {
          // Lost the race on the unique index: the whole transaction (credit
          // included) rolled back, so settle against the winner's audit row.
          if (!isUniqueViolation(error)) throw error;
          const winner =
            await this.audit.findSuccessfulGrantByKey(idempotencyKey);
          if (!winner) throw error;
          return this.replay(winner, tenantId, input);
        }
      });
    } catch (error) {
      await this.auditFailure(actor, tenantId, input, idempotencyKey, error);
      throw error;
    } finally {
      // A rolled-back attempt may have left its in-transaction balance in the cache.
      // Never let a cache failure mask the outcome (a committed grant stays a success).
      try {
        await this.credits.invalidateBalance(tenantId);
      } catch (cacheError) {
        this.logger.error({
          event: 'platform_admin_balance_invalidation_failed',
          tenantId,
          error:
            cacheError instanceof Error
              ? cacheError.message
              : String(cacheError),
        });
      }
    }

    if (input.notifyUser && !result.replayed)
      this.eventBus.publishBestEffort(
        accountNotice(tenantId, {
          kind: 'credits-added',
          units: result.amount,
        }),
      );
    return result;
  }

  private async attempt(
    actor: PlatformAdminActor,
    tenantId: string,
    input: CreditGrantInput,
    idempotencyKey: string,
  ): Promise<CreditGrantResult> {
    const prior = await this.audit.findSuccessfulGrantByKey(idempotencyKey);
    if (prior) return this.replay(prior, tenantId, input);

    const { balance } = await this.credits.grantBonus(
      tenantId,
      input.amount,
      GRANT_DESCRIPTION,
      // Never the reason or the actor: this metadata is shown to the customer.
      { origin: 'platform_admin', idempotencyKey },
    );
    await this.audit.insert({
      actorUserId: actor.authUserId,
      actorEmail: actor.email,
      action: 'credit_grant',
      targetTenantId: tenantId,
      reason: input.reason,
      payload: { amount: input.amount, balanceAfter: balance },
      success: true,
      idempotencyKey,
      ipHash: actor.ipHash,
    });
    return { tenantId, amount: input.amount, balance, replayed: false };
  }

  private replay(
    prior: PlatformAuditEvent,
    tenantId: string,
    input: CreditGrantInput,
  ): CreditGrantResult {
    const amount = Number(prior.payload.amount);
    if (
      amount !== input.amount ||
      prior.reason !== input.reason ||
      prior.targetTenantId !== tenantId
    )
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This Idempotency-Key was already used with different data',
      });
    return {
      tenantId,
      amount,
      balance: Number(prior.payload.balanceAfter),
      replayed: true,
    };
  }

  /** Outside the (rolled back) transaction; if even this fails, only the log remains. */
  private async auditFailure(
    actor: PlatformAdminActor,
    tenantId: string,
    input: CreditGrantInput,
    idempotencyKey: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.audit.insert({
        actorUserId: actor.authUserId,
        actorEmail: actor.email,
        action: 'credit_grant',
        targetTenantId: tenantId,
        reason: input.reason,
        payload: { amount: input.amount, error: errorCode(error) },
        success: false,
        idempotencyKey,
        ipHash: actor.ipHash,
      });
    } catch (auditError) {
      this.logger.error({
        event: 'platform_admin_failure_audit_lost',
        actor: actor.email,
        tenantId,
        amount: input.amount,
        idempotencyKey,
        error: errorCode(error),
        auditError:
          auditError instanceof Error ? auditError.message : String(auditError),
      });
    }
  }
}
