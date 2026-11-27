import { Inject, Injectable } from '@nestjs/common';
import { CompanyService } from '@/modules/company/application/company.service';
import { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import { runValidators } from '@/modules/fiscal-core/application/emission-pipeline';
import { NfeEmissionPreconditions } from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import {
  nfeConfigurationError,
  nfeValidationFailed,
} from '@/modules/nfe/application/nfe-errors';
import { nfeIssuerOf } from '@/modules/nfe/application/nfe-issuer';
import type { PreparedNfe } from '@/modules/nfe/application/nfe-preparation.service';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { buildNfceDraft } from '../domain/nfce-draft';
import type { NfceInput } from '../domain/nfce-input';
import { NFCE_PRE_SEND_VALIDATORS } from '../domain/validators';

/**
 * The checks every way into a NFC-e shares (the dry-run now, the emission later): the company and
 * release preconditions for model 65, then the validators. It writes nothing and numbers nothing.
 */
@Injectable()
export class NfcePreparation {
  constructor(
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settingsRepository: ICompanyNfeSettingsRepository,
    private readonly preconditions: NfeEmissionPreconditions,
  ) {}

  async prepare(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfceInput,
  ): Promise<PreparedNfe> {
    const company = await this.companies.findById(
      input.companyId,
      tenantId,
      environment,
    );
    const settings = await this.settingsRepository.find(
      input.companyId,
      tenantId,
    );
    const blocked = await this.preconditions.check({
      environment,
      company,
      settings,
      model: 65,
    });
    if (blocked) throw nfeConfigurationError(blocked);
    const issuer = nfeIssuerOf(company, settings);
    // `settings` is set: `nfeIssuerOf` would have thrown otherwise.
    const draft = buildNfceDraft(
      input,
      issuer,
      settings as NfeSettings,
      environment,
    );
    const issues = await runValidators(NFCE_PRE_SEND_VALIDATORS, draft, {
      environment,
    });
    if (issues.length > 0) throw nfeValidationFailed(issues);
    return { company, settings: settings as NfeSettings, issuer, draft };
  }
}
