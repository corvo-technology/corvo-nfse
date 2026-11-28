import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Company } from '@/modules/company/domain/company';
import { nfeReadinessMissing } from '@/modules/company/domain/nfe-readiness';
import { nfceSupported } from '@/infra/external/nfe/sefaz/supported-authorities';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import {
  registrationBlocks,
  registrationMessage,
} from '@/modules/company/domain/nfe-registration';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

export type NfePreconditionCode =
  | 'NFE_PRODUCTION_DISABLED'
  | 'COMPANY_NFE_INCOMPLETE'
  | 'STATE_REGISTRATION_NOT_ENABLED'
  | 'UF_NOT_ENABLED';

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
 * Checked before anything is numbered, in this order: production lock (the one switch,
 * `NFE_PRODUCTION_ENABLED`), complete company, for the model of the document (55 NF-e, 65 NFC-e).
 * In test (homologação) every workspace may issue, with no release and no table to fill in. The only
 * UF limit left is a fact of the code: a NFC-e needs the QR Code addresses of its UF (today SP), and
 * a UF without them answers `UF_NOT_ENABLED`. The NFS-e never goes through here.
 */
@Injectable()
export class NfeEmissionPreconditions {
  constructor(private readonly config: ConfigService) {}

  /** Is live (production) emission of NF-e/NFC-e switched on? The only release switch left. */
  productionEnabled(): boolean {
    return this.config.get<boolean>('NFE_PRODUCTION_ENABLED') === true;
  }

  check(input: NfeEmissionPreconditionsInput): NfePreconditionError | null {
    const label = input.model === 65 ? 'NFC-e' : 'NF-e';
    if (input.environment === 'live' && !this.productionEnabled())
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
    // The last SEFAZ consulta (fresh and conclusive) says the IE will be refused: stop here, before a
    // number is used. The consulta never blocks when it is old, unclear or about another IE.
    const registration = registrationBlocks(
      input.settings?.registrationCheck,
      input.settings?.stateRegistration ?? null,
      input.model,
    );
    if (registration)
      return configurationError(
        'STATE_REGISTRATION_NOT_ENABLED',
        `${registrationMessage(registration, {
          uf: input.company.addressState ?? '',
          stateRegistration: input.settings?.stateRegistration ?? null,
        })} Depois de resolver, confira de novo nas configurações de NF-e.`,
        { status: registration },
      );
    if (input.model === 65) {
      const uf = input.company.addressState ?? '';
      if (!nfceSupported(uf, input.environment === 'live' ? 1 : 2))
        return configurationError(
          'UF_NOT_ENABLED',
          'NFC-e ainda não disponível para esta UF',
          { uf },
        );
    }
    return null;
  }
}
