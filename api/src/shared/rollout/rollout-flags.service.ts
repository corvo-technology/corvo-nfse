import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  RolloutConfig,
  RolloutFlagConfig,
} from '@/infra/config/configuration.types';

export type RolloutFlag =
  | 'FISCAL_DPS_CONFORMANCE'
  | 'SIMPLES_TOTTRIB'
  | 'CNPJ_REGISTRY_CHECK';

const FLAG_KEY: Record<
  RolloutFlag,
  keyof Pick<
    RolloutConfig,
    'fiscalDpsConformance' | 'simplesTottrib' | 'cnpjRegistryCheck'
  >
> = {
  FISCAL_DPS_CONFORMANCE: 'fiscalDpsConformance',
  SIMPLES_TOTTRIB: 'simplesTottrib',
  CNPJ_REGISTRY_CHECK: 'cnpjRegistryCheck',
};

function allowed(tenants: '*' | string[], tenantId: string): boolean {
  return tenants === '*' || tenants.includes(tenantId);
}

/**
 * Environment driven flags for the gradual release of the MEI / Simples
 * Nacional focus. Read once at startup: changing a flag needs a restart.
 */
@Injectable()
export class RolloutFlagsService {
  private readonly config: RolloutConfig;

  constructor(config: ConfigService) {
    const rollout = config.get<RolloutConfig>('rollout');
    if (rollout === undefined) throw new Error('Missing rollout configuration');
    this.config = rollout;
  }

  isOn(flag: RolloutFlag, tenantId: string): boolean {
    const { on, tenants }: RolloutFlagConfig = this.config[FLAG_KEY[flag]];
    return on && allowed(tenants, tenantId);
  }

  rateMode(tenantId: string): 'off' | 'warn' | 'block' {
    const { mode, tenants } = this.config.simplesRateMode;
    return allowed(tenants, tenantId) ? mode : 'off';
  }

  /** Competence date (YYYY-MM-DD) from which the Simples rate is required; null = no date limit. */
  rateEnforcedFrom(): string | null {
    return this.config.simplesRateEnforcedFrom;
  }
}
