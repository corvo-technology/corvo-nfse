import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadCertificate } from '@/infra/external/nfe/sefaz/certificate-loader';
import { TableAuthorityEndpointResolver } from '@/infra/external/nfe/sefaz/endpoints';
import { UF_TABLE } from '@/infra/external/nfe/sefaz/uf';
import {
  SefazXmlSigner,
  withStructuralSignature,
} from '@/infra/external/nfe/sefaz/xml-signer';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import type {
  AuthorityEndpoint,
  AuthorityId,
  Uf,
} from '@/modules/fiscal-core/domain/ports/authority.port';
import type { SigningContext } from '@/modules/fiscal-core/domain/ports/gateway.port';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import {
  nfceBreakerAuthority,
  nfeBreakerAuthority,
} from '@/modules/invoice/application/fiscal-portal-breaker';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/** Stands in for the certificate when the simulator answers: it never reaches a SEFAZ. */
const SIMULATED_CERTIFICATE: LoadedCertificate = {
  certPem: '',
  keyPem: '',
  cnpj: '00000000000000',
  notAfter: new Date(8_640_000_000_000_000),
};

/**
 * What a worker needs to talk to the SEFAZ: the company's A1 certificate (decrypted in memory, for
 * this operation only, never logged or queued), the signature and the signing context. With
 * `NFE_TEST_PROVIDER=fake` a `test` company needs no certificate: the simulator ignores it and the
 * XML only gets a structural signature, like the NFS-e simulator.
 */
@Injectable()
export class NfeSefazAccess {
  private readonly signer = new SefazXmlSigner();
  private readonly resolver = new TableAuthorityEndpointResolver();

  constructor(
    private readonly config: ConfigService,
    private readonly certificates: ApplicationCertificateDecryptor,
  ) {}

  /** 1 production, 2 homologation: a `test` company always uses 2. */
  tpAmb(environment: ExecutionEnvironment): 1 | 2 {
    return environment === 'live' ? 1 : 2;
  }

  productionEnabled(): boolean {
    return this.config.get<boolean>('NFE_PRODUCTION_ENABLED') === true;
  }

  isSimulated(environment: ExecutionEnvironment): boolean {
    return (
      environment === 'test' &&
      this.config.get<string>('NFE_TEST_PROVIDER') === 'fake'
    );
  }

  authorityOf(uf: Uf, model: 55 | 65 = 55): AuthorityId {
    return model === 65 ? UF_TABLE[uf].authorizer65 : UF_TABLE[uf].authorizer55;
  }

  breakerAuthority(
    uf: Uf,
    environment: ExecutionEnvironment,
    model: 55 | 65 = 55,
  ): string {
    const authority = this.authorityOf(uf, model);
    const tpAmb = this.tpAmb(environment);
    return model === 65
      ? nfceBreakerAuthority(authority, tpAmb)
      : nfeBreakerAuthority(authority, tpAmb);
  }

  async certificate(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<LoadedCertificate> {
    if (this.isSimulated(environment)) return SIMULATED_CERTIFICATE;
    const { pfxBuffer, password } = await this.certificates.decryptCredentials(
      companyId,
      tenantId,
      environment,
    );
    return loadCertificate(pfxBuffer, password);
  }

  /** `referenceTag` is the signed element: `infNFe` (the default), `infEvento` or `infInut`. */
  sign(
    xml: string,
    certificate: LoadedCertificate,
    environment: ExecutionEnvironment,
    referenceTag: 'infNFe' | 'infEvento' | 'infInut' = 'infNFe',
  ): string {
    return this.isSimulated(environment)
      ? withStructuralSignature(xml, referenceTag)
      : this.signer.sign(xml, referenceTag, certificate);
  }

  context(
    uf: Uf,
    environment: ExecutionEnvironment,
    certificate: LoadedCertificate,
    model: 55 | 65 = 55,
  ): SigningContext {
    const tpAmb = this.tpAmb(environment);
    let target: AuthorityEndpoint;
    try {
      target = this.resolver.resolve({
        uf,
        tpAmb,
        model,
        tpEmis: 1,
        service: 'NfeAutorizacao',
      });
    } catch (error) {
      // Only the simulator may go on without an endpoint table row.
      if (!this.isSimulated(environment)) throw error;
      target = {
        authority: this.authorityOf(uf, model),
        url: '',
        soapAction: '',
        version: '4.00',
      };
    }
    return { certificate, tpAmb, target };
  }
}
