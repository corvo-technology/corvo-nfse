import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { ICompanyNfeSettingsRepository } from '../domain/company-nfe-settings.repository';
import {
  nfeReadinessMissing,
  type NfeMissingField,
} from '../domain/nfe-readiness';
import {
  NFE_SETTINGS_DEFAULTS,
  type NfeSettings,
  type NfeSettingsInput,
} from '../domain/nfe-settings';
import {
  IE_LENGTH_BY_UF,
  normalizeStateRegistration,
  validateStateRegistration,
} from '../domain/state-registration';
import { CompanyService } from './company.service';

export interface NfeSettingsView {
  companyId: string;
  stateRegistration: string | null;
  crt: number | null;
  defaultSeries: number;
  defaultNatOp: string;
  defaultCsosn: string;
  defaultOrigin: number;
  defaultPisCst: string;
  defaultCofinsCst: string;
  enabledAt: Date | null;
  /** What the company still lacks to issue an NF-e. */
  missing: NfeMissingField[];
}

@Injectable()
export class CompanyNfeSettingsService {
  constructor(
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settings: ICompanyNfeSettingsRepository,
  ) {}

  async get(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeSettingsView> {
    const company = await this.companies.findById(
      companyId,
      tenantId,
      environment,
    );
    const stored = await this.settings.find(companyId, tenantId);
    return view(companyId, stored, nfeReadinessMissing(company, stored));
  }

  async update(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfeSettingsInput,
  ): Promise<NfeSettingsView> {
    const company = await this.companies.findById(
      companyId,
      tenantId,
      environment,
    );
    const uf = company.addressState?.trim().toUpperCase();
    if (!uf || !(uf in IE_LENGTH_BY_UF))
      throw new UnprocessableEntityException({
        code: 'STATE_REGISTRATION_INVALID',
        message: 'Set the company state (UF) before the state registration',
      });
    if (!validateStateRegistration(uf as Uf, input.stateRegistration))
      throw new UnprocessableEntityException({
        code: 'STATE_REGISTRATION_INVALID',
        message: `The state registration is not valid for ${uf}`,
      });
    const saved = await this.settings.upsert(companyId, tenantId, {
      stateRegistration: normalizeStateRegistration(input.stateRegistration),
      crt: input.crt,
      defaultSeries: input.defaultSeries ?? NFE_SETTINGS_DEFAULTS.defaultSeries,
      defaultNatOp: input.defaultNatOp ?? NFE_SETTINGS_DEFAULTS.defaultNatOp,
      defaultCsosn: input.defaultCsosn ?? NFE_SETTINGS_DEFAULTS.defaultCsosn,
      defaultOrigin: input.defaultOrigin ?? NFE_SETTINGS_DEFAULTS.defaultOrigin,
      defaultPisCst: input.defaultPisCst ?? NFE_SETTINGS_DEFAULTS.defaultPisCst,
      defaultCofinsCst:
        input.defaultCofinsCst ?? NFE_SETTINGS_DEFAULTS.defaultCofinsCst,
    });
    return view(companyId, saved, nfeReadinessMissing(company, saved));
  }
}

function view(
  companyId: string,
  stored: NfeSettings | null,
  missing: NfeMissingField[],
): NfeSettingsView {
  return {
    companyId,
    stateRegistration: stored?.stateRegistration ?? null,
    crt: stored?.crt ?? null,
    defaultSeries: stored?.defaultSeries ?? NFE_SETTINGS_DEFAULTS.defaultSeries,
    defaultNatOp: stored?.defaultNatOp ?? NFE_SETTINGS_DEFAULTS.defaultNatOp,
    defaultCsosn: stored?.defaultCsosn ?? NFE_SETTINGS_DEFAULTS.defaultCsosn,
    defaultOrigin: stored?.defaultOrigin ?? NFE_SETTINGS_DEFAULTS.defaultOrigin,
    defaultPisCst: stored?.defaultPisCst ?? NFE_SETTINGS_DEFAULTS.defaultPisCst,
    defaultCofinsCst:
      stored?.defaultCofinsCst ?? NFE_SETTINGS_DEFAULTS.defaultCofinsCst,
    enabledAt: stored?.enabledAt ?? null,
    missing,
  };
}
