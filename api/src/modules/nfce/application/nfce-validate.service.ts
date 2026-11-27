import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nfceUrlsFor } from '@/infra/external/nfe/sefaz/nfce-urls';
import { dhEmiFor } from '@/infra/external/nfe/sefaz/uf';
import { withStructuralSignature } from '@/infra/external/nfe/sefaz/xml-signer';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { SchemaValidator } from '@/modules/fiscal-core/domain/ports/xml.port';
import { nfeValidationFailed } from '@/modules/nfe/application/nfe-errors';
import { nfeRespTec, nfeVerProc } from '@/modules/nfe/application/nfe-issuer';
import type { NfeValidationResult } from '@/modules/nfe/application/nfe-validate.service';
import { randomCnf } from '@/modules/nfe/domain/access-key';
import { NfeXmlBuilder } from '@/modules/nfe/domain/builder/nfe-xml-builder';
import { INfeNumberPreview } from '@/modules/nfe/domain/nfe-number-preview';
import { NFE_SCHEMA_VALIDATOR } from '@/modules/nfe/nfe.tokens';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfceInput } from '../domain/nfce-input';
import { NfcePreparation } from './nfce-preparation.service';

/**
 * Dry-run of a NFC-e: the same preconditions, validators and XSD as the real emission, with the
 * number the next emission would get (read, never reserved), the QR Code and a structural
 * signature. It writes nothing, charges nothing and never calls the SEFAZ.
 */
@Injectable()
export class NfceValidateService {
  constructor(
    private readonly preparation: NfcePreparation,
    @Inject(INfeNumberPreview) private readonly numbers: INfeNumberPreview,
    @Inject(NFE_SCHEMA_VALIDATOR) private readonly schema: SchemaValidator,
    private readonly config: ConfigService,
  ) {}

  async validate(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfceInput,
    includeXml: boolean,
  ): Promise<NfeValidationResult> {
    const { company, settings, issuer, draft } = await this.preparation.prepare(
      tenantId,
      environment,
      input,
    );
    const uf = issuer.uf as Parameters<typeof dhEmiFor>[0];
    const tpAmb = environment === 'live' ? 1 : 2;

    const { series, number } = await this.numbers.peekNext({
      companyId: company.id,
      tenantId,
      environment,
      model: 65,
      series: settings.nfceDefaultSeries,
    });
    const urls = nfceUrlsFor(uf, tpAmb);
    const built = NfeXmlBuilder.for(draft)
      .withNumber(series, number)
      .withCnf(randomCnf(number))
      .withIssuedAt(dhEmiFor(uf, new Date()))
      .withTpAmb(tpAmb)
      .withVerProc(nfeVerProc(this.config))
      .withRespTec(nfeRespTec(this.config))
      .withSupplement({ qrCodeBase: urls.qrCode, urlChave: urls.urlChave })
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
