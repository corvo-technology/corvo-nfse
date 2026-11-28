import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookupCadastro } from '@/infra/external/nfe/sefaz/cadastro';
import { loadCertificate } from '@/infra/external/nfe/sefaz/certificate-loader';
import { SefazSoapClient } from '@/infra/external/nfe/sefaz/soap-client';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { ICadastroLookup } from '../domain/cadastro-lookup';
import type { RegistrationLookup } from '../domain/nfe-registration';

/** The consulta is a small read: a short wait, so saving the settings never hangs on a slow SEFAZ. */
const TIMEOUT_MS = 10_000;

/**
 * "Consulta Cadastro" of the SEFAZ with the A1 certificate of the company (decrypted in memory for
 * this call only, never logged). The simulator (`NFE_TEST_PROVIDER=fake`) has no cadastro, so a test
 * company on it answers `unavailable`. The SOAP client logs only authority, duration and outcome.
 */
@Injectable()
export class SefazCadastroLookup extends ICadastroLookup {
  private readonly soap = new SefazSoapClient();

  constructor(
    private readonly config: ConfigService,
    private readonly certificates: ApplicationCertificateDecryptor,
  ) {
    super();
  }

  async lookup(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    uf: Uf,
    cnpj: string,
  ): Promise<RegistrationLookup> {
    if (
      environment === 'test' &&
      this.config.get<string>('NFE_TEST_PROVIDER') === 'fake'
    )
      return { kind: 'unavailable' };
    let certificate: LoadedCertificate;
    try {
      const { pfxBuffer, password } =
        await this.certificates.decryptCredentials(
          companyId,
          tenantId,
          environment,
        );
      certificate = loadCertificate(pfxBuffer, password);
    } catch {
      return { kind: 'no_certificate' };
    }
    try {
      return await lookupCadastro(this.soap, TIMEOUT_MS, uf, cnpj, certificate);
    } catch {
      return { kind: 'unavailable' };
    }
  }
}
