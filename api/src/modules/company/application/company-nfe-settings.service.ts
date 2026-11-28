import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { ICadastroLookup } from '../domain/cadastro-lookup';
import { ICompanyNfeSettingsRepository } from '../domain/company-nfe-settings.repository';
import {
  nfeReadinessMissing,
  type NfeMissingField,
} from '../domain/nfe-readiness';
import {
  assessRegistration,
  CONCLUSIVE_STATUSES,
  registrationMessage,
  type RegistrationAssessment,
  type RegistrationStatus,
} from '../domain/nfe-registration';
import type { Company } from '../domain/company';
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
  /** What goes in the XML: the stored override, or the CRT of the tax regime of the company. */
  crt: number | null;
  /** Tax regime of the company (its fiscal profile), to show why the CRT is what it is. */
  taxRegime: string | null;
  defaultSeries: number;
  nfceDefaultSeries: number;
  nfceAutoOffline: boolean;
  defaultNatOp: string;
  defaultCsosn: string;
  defaultOrigin: number;
  defaultPisCst: string;
  defaultCofinsCst: string;
  enabledAt: Date | null;
  /** What the company still lacks to issue an NF-e. */
  missing: NfeMissingField[];
  /**
   * Set only by an update: the SEFAZ consulta says the IE just saved will be refused. A warning, never
   * a block (the consulta can be wrong or out of date); `null` when it agrees or could not be asked.
   */
  registrationWarning: string | null;
  /**
   * Can the company issue NF-e/NFC-e? With `check` the answer is live (asked at the SEFAZ now); without
   * it, the last conclusive answer kept with the settings, or `null` when none was ever kept.
   */
  readiness: NfeReadinessView | null;
}

export type NfeReadinessStatus = RegistrationStatus | 'company_incomplete';

/** The answer of "can this company issue an NF-e/NFC-e?", checked against the SEFAZ cadastro. */
export interface NfeReadinessView {
  companyId: string;
  /** True only when nothing is missing and the SEFAZ says the IE is enabled. */
  ready: boolean;
  status: NfeReadinessStatus;
  /** Plain pt-BR sentence for the person (the screens translate from `status`). */
  message: string;
  stateRegistration: string | null;
  /** The one enabled IE of the CNPJ at the SEFAZ, when there is exactly one. */
  suggestedStateRegistration: string | null;
  registrations: { stateRegistration: string; enabled: boolean }[];
  /** Only for `sefaz_rejected`: the code and the reason the SEFAZ gave. */
  sefazCStat: string | null;
  sefazReason: string | null;
  missing: NfeMissingField[];
  checkedAt: Date | null;
}

const WARNING_STATUSES: readonly RegistrationStatus[] = [
  'no_registration',
  'not_enabled',
  'not_credentialed',
  'ie_mismatch',
];

@Injectable()
export class CompanyNfeSettingsService {
  constructor(
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settings: ICompanyNfeSettingsRepository,
    @Inject(ICadastroLookup)
    private readonly cadastro: ICadastroLookup,
  ) {}

  /**
   * The settings of the company. With `check`, also asks the SEFAZ cadastro (needs the company
   * certificate; a UF without the service, or a SEFAZ that does not answer, is "unavailable" — nothing
   * is known — never an error). Without it, no SEFAZ call: `readiness` is the last conclusive answer.
   */
  async get(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    options: { check?: boolean } = {},
  ): Promise<NfeSettingsView> {
    const company = await this.companies.findById(
      companyId,
      tenantId,
      environment,
    );
    const stored = await this.settings.find(companyId, tenantId);
    let readiness: NfeReadinessView | null = null;
    if (options.check) {
      const ie = stored?.stateRegistration ?? null;
      const assessment = await this.assess(company, tenantId, environment, ie);
      if (ie) await this.rememberCheck(company.id, tenantId, ie, assessment);
      readiness = this.readinessOf(company, stored, assessment, new Date());
    } else {
      readiness = this.storedReadiness(company, stored);
    }
    return this.build(company, stored, tenantId, null, readiness);
  }

  private readinessOf(
    company: Company,
    stored: NfeSettings | null,
    assessment: RegistrationAssessment,
    checkedAt: Date,
  ): NfeReadinessView {
    const ie = stored?.stateRegistration ?? null;
    const missing = nfeReadinessMissing(company, stored);
    const incomplete =
      missing.some((field) => field !== 'state_registration') &&
      (assessment.status === 'ready' || assessment.status === 'unavailable');
    const status: NfeReadinessStatus = incomplete
      ? 'company_incomplete'
      : assessment.status;
    return {
      companyId: company.id,
      ready: status === 'ready' && missing.length === 0,
      status,
      message:
        status === 'company_incomplete'
          ? 'Falta completar o cadastro da empresa para emitir NF-e.'
          : this.messageOf(company, ie, assessment),
      stateRegistration: ie,
      suggestedStateRegistration: assessment.suggested,
      registrations: assessment.registrations,
      sefazCStat: assessment.sefaz?.cStat ?? null,
      sefazReason: assessment.sefaz?.reason ?? null,
      missing,
      checkedAt,
    };
  }

  /** The last conclusive answer kept with the settings, for the IE saved now; `null` when there is none. */
  private storedReadiness(
    company: Company,
    stored: NfeSettings | null,
  ): NfeReadinessView | null {
    const check = stored?.registrationCheck;
    const ie = stored?.stateRegistration ?? null;
    if (!check || !ie) return null;
    if (check.stateRegistration.replace(/\D/g, '') !== ie.replace(/\D/g, ''))
      return null;
    return this.readinessOf(
      company,
      stored,
      { status: check.status, suggested: null, registrations: [] },
      check.checkedAt,
    );
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

    let stateRegistration = input.stateRegistration?.trim() ?? '';
    let assessment: RegistrationAssessment | null = null;
    if (stateRegistration === '') {
      // No IE sent: take the one the SEFAZ has, when there is exactly one enabled.
      assessment = await this.assess(company, tenantId, environment, null);
      if (assessment.status !== 'ie_suggested' || !assessment.suggested)
        throw new UnprocessableEntityException({
          code: 'STATE_REGISTRATION_REQUIRED',
          message: this.messageOf(company, null, assessment),
        });
      stateRegistration = assessment.suggested;
    }
    if (!validateStateRegistration(uf as Uf, stateRegistration))
      throw new UnprocessableEntityException({
        code: 'STATE_REGISTRATION_INVALID',
        message: `The state registration is not valid for ${uf}`,
      });
    const ie = normalizeStateRegistration(stateRegistration);
    const saved = await this.settings.upsert(companyId, tenantId, {
      stateRegistration: ie,
      crt: input.crt ?? null,
      defaultSeries: input.defaultSeries ?? NFE_SETTINGS_DEFAULTS.defaultSeries,
      nfceDefaultSeries:
        input.nfceDefaultSeries ?? NFE_SETTINGS_DEFAULTS.nfceDefaultSeries,
      nfceAutoOffline:
        input.nfceAutoOffline ?? NFE_SETTINGS_DEFAULTS.nfceAutoOffline,
      defaultNatOp: input.defaultNatOp ?? NFE_SETTINGS_DEFAULTS.defaultNatOp,
      defaultCsosn: input.defaultCsosn ?? NFE_SETTINGS_DEFAULTS.defaultCsosn,
      defaultOrigin: input.defaultOrigin ?? NFE_SETTINGS_DEFAULTS.defaultOrigin,
      defaultPisCst: input.defaultPisCst ?? NFE_SETTINGS_DEFAULTS.defaultPisCst,
      defaultCofinsCst:
        input.defaultCofinsCst ?? NFE_SETTINGS_DEFAULTS.defaultCofinsCst,
    });
    // The IE just saved against the SEFAZ cadastro: a warning when it will be refused, never a block.
    const checked = await this.assess(company, tenantId, environment, ie);
    await this.rememberCheck(companyId, tenantId, ie, checked);
    // Read again: the CRT shown is the one that follows the fiscal profile when nothing was set.
    const stored = await this.settings.find(companyId, tenantId);
    return this.build(
      company,
      stored ?? saved,
      tenantId,
      WARNING_STATUSES.includes(checked.status)
        ? this.messageOf(company, ie, checked)
        : null,
    );
  }

  /** The cadastro consulta, as an assessment; any failure is "unavailable". */
  private async assess(
    company: Company,
    tenantId: string,
    environment: ExecutionEnvironment,
    ie: string | null,
  ): Promise<RegistrationAssessment> {
    const uf = company.addressState?.trim().toUpperCase();
    const cnpj = company.taxId.replace(/\D/g, '');
    if (!uf || !(uf in IE_LENGTH_BY_UF))
      return assessRegistration(ie, { kind: 'unavailable' });
    try {
      return assessRegistration(
        ie,
        await this.cadastro.lookup(
          company.id,
          tenantId,
          environment,
          uf as Uf,
          cnpj,
        ),
      );
    } catch {
      return assessRegistration(ie, { kind: 'unavailable' });
    }
  }

  /** Keeps a conclusive answer for the validator; an inconclusive one leaves the last answer alone. */
  private async rememberCheck(
    companyId: string,
    tenantId: string,
    ie: string,
    assessment: RegistrationAssessment,
  ): Promise<void> {
    if (!CONCLUSIVE_STATUSES.includes(assessment.status)) return;
    await this.settings.saveRegistrationCheck(companyId, tenantId, {
      status: assessment.status,
      checkedAt: new Date(),
      stateRegistration: ie.replace(/\D/g, ''),
    });
  }

  private messageOf(
    company: Company,
    ie: string | null,
    assessment: RegistrationAssessment,
  ): string {
    return registrationMessage(assessment.status, {
      uf: company.addressState?.trim().toUpperCase() ?? '',
      stateRegistration: ie,
      suggested: assessment.suggested,
      registrations: assessment.registrations,
      sefaz: assessment.sefaz,
    });
  }

  private async build(
    company: Company,
    stored: NfeSettings | null,
    tenantId: string,
    registrationWarning: string | null,
    readiness: NfeReadinessView | null = this.storedReadiness(company, stored),
  ): Promise<NfeSettingsView> {
    const regime = await this.companies.currentRegime(company.id, tenantId);
    return view(
      company.id,
      stored,
      nfeReadinessMissing(company, stored),
      regime.taxRegime,
      registrationWarning,
      readiness,
    );
  }
}

function view(
  companyId: string,
  stored: NfeSettings | null,
  missing: NfeMissingField[],
  taxRegime: string | null,
  registrationWarning: string | null,
  readiness: NfeReadinessView | null,
): NfeSettingsView {
  return {
    companyId,
    stateRegistration: stored?.stateRegistration ?? null,
    crt: stored?.crt ?? null,
    taxRegime,
    defaultSeries: stored?.defaultSeries ?? NFE_SETTINGS_DEFAULTS.defaultSeries,
    nfceDefaultSeries:
      stored?.nfceDefaultSeries ?? NFE_SETTINGS_DEFAULTS.nfceDefaultSeries,
    nfceAutoOffline:
      stored?.nfceAutoOffline ?? NFE_SETTINGS_DEFAULTS.nfceAutoOffline,
    defaultNatOp: stored?.defaultNatOp ?? NFE_SETTINGS_DEFAULTS.defaultNatOp,
    defaultCsosn: stored?.defaultCsosn ?? NFE_SETTINGS_DEFAULTS.defaultCsosn,
    defaultOrigin: stored?.defaultOrigin ?? NFE_SETTINGS_DEFAULTS.defaultOrigin,
    defaultPisCst: stored?.defaultPisCst ?? NFE_SETTINGS_DEFAULTS.defaultPisCst,
    defaultCofinsCst:
      stored?.defaultCofinsCst ?? NFE_SETTINGS_DEFAULTS.defaultCofinsCst,
    enabledAt: stored?.enabledAt ?? null,
    missing,
    registrationWarning,
    readiness,
  };
}
