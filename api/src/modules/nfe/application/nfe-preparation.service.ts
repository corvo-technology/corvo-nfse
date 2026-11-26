import { Inject, Injectable } from '@nestjs/common';
import { CompanyService } from '@/modules/company/application/company.service';
import type { Company } from '@/modules/company/domain/company';
import { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import { runValidators } from '@/modules/fiscal-core/application/emission-pipeline';
import { NfeEmissionPreconditions } from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { buildDraft, type NfeDraft, type NfeIssuer } from '../domain/nfe-draft';
import type { NfeInput } from '../domain/nfe-input';
import { NFE_PRE_SEND_VALIDATORS } from '../domain/validators';
import { nfeIssuerOf } from './nfe-issuer';
import { nfeConfigurationError, nfeValidationFailed } from './nfe-errors';

export interface PreparedNfe {
  company: Company;
  settings: NfeSettings;
  issuer: NfeIssuer;
  draft: NfeDraft;
}

/**
 * The checks every way into an NF-e shares (the dry-run, the emission and the resubmission): the
 * company and release preconditions, then the validators. It writes nothing and numbers nothing.
 */
@Injectable()
export class NfePreparation {
  constructor(
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settingsRepository: ICompanyNfeSettingsRepository,
    private readonly preconditions: NfeEmissionPreconditions,
  ) {}

  async prepare(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfeInput,
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
      model: 55,
    });
    if (blocked) throw nfeConfigurationError(blocked);
    const issuer = nfeIssuerOf(company, settings);
    // `settings` is set: `nfeIssuerOf` would have thrown otherwise.
    const draft = buildDraft(
      input,
      issuer,
      settings as NfeSettings,
      environment,
    );
    const issues = await runValidators(NFE_PRE_SEND_VALIDATORS, draft, {
      environment,
    });
    if (issues.length > 0) throw nfeValidationFailed(issues);
    return { company, settings: settings as NfeSettings, issuer, draft };
  }
}
