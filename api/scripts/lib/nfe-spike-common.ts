/**
 * Shared bits of the manual NF-e spike scripts. Everything secret comes from environment
 * variables at run time; nothing here prints a password, a PFX, a key or a full XML.
 */
import { readFileSync } from 'node:fs';
import { loadCertificate } from '../../src/infra/external/nfe/sefaz/certificate-loader';
import { TableAuthorityEndpointResolver } from '../../src/infra/external/nfe/sefaz/endpoints';
import { XmllintSchemaValidator } from '../../src/infra/external/nfe/sefaz/schema-validator';
import { SefazSoapClient } from '../../src/infra/external/nfe/sefaz/soap-client';
import { isUf } from '../../src/infra/external/nfe/sefaz/uf';
import type { Uf } from '../../src/modules/fiscal-core/domain/ports/authority.port';
import type { LoadedCertificate } from '../../src/modules/fiscal-core/domain/ports/xml.port';

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Defina ${name} no ambiente (veja docs/fiscal/nfe-spike.md).`,
    );
    process.exit(2);
  }
  return value;
}

/** The spike only ever talks to homologação. */
export function assertHomologacaoOnly(): 2 {
  const raw = process.env.NFE_SPIKE_TP_AMB;
  if (raw !== undefined && raw !== '2')
    throw new Error('O spike só roda em homologação (tpAmb=2).');
  return 2;
}

export function spikeUf(): Uf {
  const uf = requiredEnv('NFE_SPIKE_UF').toUpperCase();
  if (!isUf(uf)) throw new Error(`UF desconhecida: ${uf}`);
  return uf;
}

export function loadSpikeCertificate(): LoadedCertificate {
  const path = requiredEnv('NFE_SPIKE_PFX_PATH');
  const password = requiredEnv('NFE_SPIKE_PFX_PASSWORD');
  return loadCertificate(readFileSync(path), password);
}

export function buildSpikeClients() {
  return {
    soap: new SefazSoapClient(),
    resolver: new TableAuthorityEndpointResolver(),
    validator: new XmllintSchemaValidator(),
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
