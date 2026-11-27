import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Company } from '@/modules/company/domain/company';
import { nfeReadinessMissing } from '@/modules/company/domain/nfe-readiness';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  NFE_ENABLED_AUTHORITIES,
  type NfeEnabledAuthorities,
} from '../domain/nfe-enabled-authorities';

export type NfePreconditionCode =
  'NFE_PRODUCTION_DISABLED' | 'COMPANY_NFE_INCOMPLETE' | 'UF_NOT_ENABLED';

/** Shape-compatible with the invoice module's `FiscalError`; fiscal-core must not import it. */
export interface NfePreconditionError {
  readonly code: NfePreconditionCode;
  readonly message: string;
  readonly step: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: false;
  readonly category: 'CONFIGURATION';
}

export interface NfeEmissionPreconditionsInput {
  environment: ExecutionEnvironment;
  company: Company;
  settings: NfeSettings | null;
  /** 55 = NF-e, 65 = NFC-e. */
  model: 55 | 65;
}

const STEP = 'nfe_preconditions';

function configurationError(
  code: NfePreconditionCode,
  message: string,
  details: Record<string, unknown> = {},
): NfePreconditionError {
  return Object.freeze({
    code,
    message,
    step: STEP,
    details: Object.freeze(details),
    retryable: false as const,
    category: 'CONFIGURATION' as const,
  });
}

/**
 * Checked before anything is numbered, in this order: production lock, complete company, released
 * UF, for the model of the document (55 NF-e, 65 NFC-e). The NFS-e never goes through here.
 */
@Injectable()
export class NfeEmissionPreconditions {
  constructor(
    private readonly config: ConfigService,
    @Inject(NFE_ENABLED_AUTHORITIES)
    private readonly authorities: NfeEnabledAuthorities,
  ) {}

  async check(
    input: NfeEmissionPreconditionsInput,
  ): Promise<NfePreconditionError | null> {
    const label = input.model === 65 ? 'NFC-e' : 'NF-e';
    if (
      input.environment === 'live' &&
      this.config.get<boolean>('NFE_PRODUCTION_ENABLED') !== true
    )
      return configurationError(
        'NFE_PRODUCTION_DISABLED',
        `${label} em produção ainda não liberada`,
      );
    const missing = nfeReadinessMissing(input.company, input.settings);
    if (missing.length > 0)
      return configurationError(
        'COMPANY_NFE_INCOMPLETE',
        `Complete o cadastro da empresa para emitir ${label}`,
        { missing },
      );
    const uf = input.company.addressState ?? '';
    const tpAmb = input.environment === 'live' ? 1 : 2;
    if (!(await this.authorities.isEnabled(uf, input.model, tpAmb)))
      return configurationError('UF_NOT_ENABLED', 'UF ainda não liberada', {
        uf,
      });
    return null;
  }
}
