import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UF_TABLE, dhEmiFor, isUf } from '@/infra/external/nfe/sefaz/uf';
import { withStructuralSignature } from '@/infra/external/nfe/sefaz/xml-signer';
import { CompanyService } from '@/modules/company/application/company.service';
import { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import { NfeEmissionPreconditions } from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import { runValidators } from '@/modules/fiscal-core/application/emission-pipeline';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { SchemaValidator } from '@/modules/fiscal-core/domain/ports/xml.port';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { NfeXmlBuilder } from '../domain/builder/nfe-xml-builder';
import type { NfeRespTec } from '../domain/builder/context';
import { randomCnf } from '../domain/access-key';
import { INfeNumberPreview } from '../domain/nfe-number-preview';
import { buildDraft, type NfeIssuer } from '../domain/nfe-draft';
import type { NfeInput } from '../domain/nfe-input';
import { NFE_PRE_SEND_VALIDATORS } from '../domain/validators';
import { NFE_SCHEMA_VALIDATOR } from '../nfe.tokens';
import { nfeConfigurationError, nfeValidationFailed } from './nfe-errors';

export interface NfeValidationResult {
  valid: true;
  accessKeyPreview: string;
  xml?: string;
}

/**
 * Dry-run of an NF-e: the same preconditions, validators and XSD as the real emission, with the
 * number the next emission would get (read, never reserved) and a structural signature. It writes
 * nothing, charges nothing and never calls the SEFAZ.
 */
@Injectable()
export class NfeValidateService {
  constructor(
    private readonly companies: CompanyService,
    @Inject(ICompanyNfeSettingsRepository)
    private readonly settingsRepository: ICompanyNfeSettingsRepository,
    private readonly preconditions: NfeEmissionPreconditions,
    @Inject(INfeNumberPreview) private readonly numbers: INfeNumberPreview,
    @Inject(NFE_SCHEMA_VALIDATOR) private readonly schema: SchemaValidator,
    private readonly config: ConfigService,
  ) {}

  async validate(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfeInput,
    includeXml: boolean,
  ): Promise<NfeValidationResult> {
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
    // `settings` is set: COMPANY_NFE_INCOMPLETE above covers a missing IE and CRT.
    const uf = company.addressState?.trim().toUpperCase() ?? '';
    if (!settings || !isUf(uf) || !company.addressCity?.trim())
      throw nfeConfigurationError({
        code: 'COMPANY_NFE_INCOMPLETE',
        message: 'Complete o cadastro da empresa para emitir NF-e',
        details: { missing: ['address_city'] },
      });

    const issuer: NfeIssuer = {
      cnpj: company.taxId.replace(/[.\s/-]/g, '').toUpperCase(),
      legalName: company.legalName,
      tradeName: company.tradeName ?? null,
      uf,
      cUF: UF_TABLE[uf].cUF,
      stateRegistration: settings.stateRegistration ?? '',
      crt: settings.crt,
      address: {
        street: company.addressStreet ?? '',
        number: company.addressNumber ?? '',
        complement: company.addressComplement ?? null,
        district: company.addressDistrict ?? '',
        zip: (company.addressZip ?? '').replace(/\D/g, ''),
        cityCode: company.municipalityCode ?? '',
        city: company.addressCity,
        state: uf,
      },
    };
    const draft = buildDraft(input, issuer, settings, environment);

    const issues = await runValidators(NFE_PRE_SEND_VALIDATORS, draft, {
      environment,
    });
    if (issues.length > 0) throw nfeValidationFailed(issues);

    const { series, number } = await this.numbers.peekNext({
      companyId: company.id,
      tenantId,
      environment,
      model: 55,
      series: settings.defaultSeries,
    });
    const built = NfeXmlBuilder.for(draft)
      .withNumber(series, number)
      .withCnf(randomCnf(number))
      .withIssuedAt(dhEmiFor(uf, new Date()))
      .withVerProc(this.verProc())
      .withRespTec(this.respTec())
      .build();

    const schemaResult = await this.schema.validate(
      withStructuralSignature(built.xml, built.referenceTag),
      'nfe',
    );
    if (!schemaResult.ok) {
      const found: ValidationIssue[] = schemaResult.errors.map((e) => ({
        field: 'xml',
        code: 'NFE_SCHEMA_INVALID',
        message: e.message,
      }));
      throw nfeValidationFailed(found);
    }
    return {
      valid: true,
      accessKeyPreview: built.accessKey,
      ...(includeXml ? { xml: built.xml } : {}),
    };
  }

  private verProc(): string {
    const version = this.config.get<string>('APP_VERSION');
    return version ? `Corvo ${version}`.slice(0, 20) : 'Corvo';
  }

  /** The four NFE_RESP_TEC_* settings, or nothing when any is empty. */
  private respTec(): NfeRespTec | null {
    const get = (key: string) => this.config.get<string>(key)?.trim() ?? '';
    const tec: NfeRespTec = {
      cnpj: get('NFE_RESP_TEC_CNPJ'),
      contact: get('NFE_RESP_TEC_CONTACT'),
      email: get('NFE_RESP_TEC_EMAIL'),
      phone: get('NFE_RESP_TEC_PHONE'),
    };
    return Object.values(tec).every(Boolean) ? tec : null;
  }
}
