import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dhEmiFor } from '@/infra/external/nfe/sefaz/uf';
import { withStructuralSignature } from '@/infra/external/nfe/sefaz/xml-signer';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { SchemaValidator } from '@/modules/fiscal-core/domain/ports/xml.port';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { NfeXmlBuilder } from '../domain/builder/nfe-xml-builder';
import { randomCnf } from '../domain/access-key';
import { INfeNumberPreview } from '../domain/nfe-number-preview';
import type { NfeInput } from '../domain/nfe-input';
import { NFE_SCHEMA_VALIDATOR } from '../nfe.tokens';
import { nfeRespTec, nfeVerProc } from './nfe-issuer';
import { NfePreparation } from './nfe-preparation.service';
import { nfeValidationFailed } from './nfe-errors';

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
    private readonly preparation: NfePreparation,
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
    const { company, settings, issuer, draft } = await this.preparation.prepare(
      tenantId,
      environment,
      input,
    );
    const uf = issuer.uf as Parameters<typeof dhEmiFor>[0];

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
      .withVerProc(nfeVerProc(this.config))
      .withRespTec(nfeRespTec(this.config))
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
}
