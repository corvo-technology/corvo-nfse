/**
 * Manual spike: signs a fixture NF-e (Simples, CSOSN 102/400, PIS/COFINS CST 49 zeroed) and sends
 * it to NfeAutorizacao4 in homologação with indSinc=1.
 *
 *   NFE_SPIKE_PFX_PATH=... NFE_SPIKE_PFX_PASSWORD=... NFE_SPIKE_UF=SP NFE_SPIKE_IE=... \
 *     yarn ts-node -r tsconfig-paths/register scripts/nfe-spike-authorize.ts
 *
 * Optional: NFE_SPIKE_NUMBER (nNF, default 1), NFE_SPIKE_SERIES (default 1), NFE_SPIKE_CSOSN
 * (102 or 400), NFE_SPIKE_CMUN, NFE_SPIKE_XMUN, NFE_SPIKE_CEP, NFE_SPIKE_XLGR, NFE_SPIKE_XNOME,
 * NFE_SPIKE_NCM, NFE_SPIKE_SCENARIO=reject-ncm (invalid NCM, to provoke a rejection) and
 * NFE_SPIKE_DRY_RUN=1 (builds, validates and signs, but sends nothing).
 *
 * Prints only cStat, xMotivo, protocol and the access key. Never the PFX, password, key or XML.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import {
  SefazXmlSigner,
  withStructuralSignature,
} from '../src/infra/external/nfe/sefaz/xml-signer';
import { classifyCstat } from '../src/infra/external/nfe/sefaz/cstat';
import { UF_TABLE, dhEmiFor } from '../src/infra/external/nfe/sefaz/uf';
import {
  buildAccessKey,
  randomCnf,
} from '../src/modules/nfe/domain/access-key';
import {
  assertHomologacaoOnly,
  buildSpikeClients,
  escapeXml,
  loadSpikeCertificate,
  requiredEnv,
  spikeUf,
} from './lib/nfe-spike-common';

const TEMPLATE = join(
  __dirname,
  '../test/fixtures/nfe/xml/spike-nfe-template.xml',
);
const DEFAULT_MUNICIPALITY: Record<string, [string, string, string]> = {
  SP: ['3550308', 'Sao Paulo', '01001000'],
};

const optional = (name: string, fallback: string): string =>
  process.env[name] || fallback;

async function main(): Promise<void> {
  const tpAmb = assertHomologacaoOnly();
  const uf = spikeUf();
  const certificate = loadSpikeCertificate();
  const dry = process.env.NFE_SPIKE_DRY_RUN === '1';
  const { soap, resolver, validator } = buildSpikeClients();

  const defaults = DEFAULT_MUNICIPALITY[uf];
  const cMun =
    process.env.NFE_SPIKE_CMUN ??
    defaults?.[0] ??
    requiredEnv('NFE_SPIKE_CMUN');
  const csosn = optional('NFE_SPIKE_CSOSN', '102');
  if (csosn !== '102' && csosn !== '400')
    throw new Error('NFE_SPIKE_CSOSN deve ser 102 ou 400');
  const number = Number(optional('NFE_SPIKE_NUMBER', '1'));
  const series = Number(optional('NFE_SPIKE_SERIES', '1'));
  const ncm =
    process.env.NFE_SPIKE_SCENARIO === 'reject-ncm'
      ? '99999999'
      : optional('NFE_SPIKE_NCM', '21011110');

  const dhEmi = dhEmiFor(uf, new Date());
  const cNF = randomCnf(number);
  const accessKey = buildAccessKey({
    cUF: UF_TABLE[uf].cUF,
    issuedAt: dhEmi,
    cnpj: certificate.cnpj,
    model: 55,
    series,
    number,
    tpEmis: 1,
    cNF,
  });

  const values: Record<string, string> = {
    CHAVE: accessKey,
    CUF: UF_TABLE[uf].cUF,
    CNF: cNF,
    SERIE: String(series),
    NNF: String(number),
    DHEMI: dhEmi,
    CMUN: cMun,
    CDV: accessKey.slice(43),
    CNPJ: certificate.cnpj,
    XNOME: escapeXml(optional('NFE_SPIKE_XNOME', 'EMPRESA DE TESTE LTDA')),
    XLGR: escapeXml(optional('NFE_SPIKE_XLGR', 'Rua de Teste')),
    XMUN: escapeXml(
      optional('NFE_SPIKE_XMUN', defaults?.[1] ?? 'Municipio de Teste'),
    ),
    UF: uf,
    CEP: optional('NFE_SPIKE_CEP', defaults?.[2] ?? '00000000'),
    IE: requiredEnv('NFE_SPIKE_IE'),
    NCM: ncm,
    CSOSN: csosn,
  };
  const nfeXml = readFileSync(TEMPLATE, 'utf8')
    .trim()
    .replace(/\{\{([A-Z]+)\}\}/g, (_m, key: string) => values[key] ?? '');

  // 1. XSD with a structural signature (the real one needs the key).
  const structural = await validator.validate(
    withStructuralSignature(nfeXml, 'infNFe'),
    'nfe',
  );
  console.log(
    `[spike] XSD da NFe (estrutural): ${structural.ok ? 'ok' : 'FALHOU'}`,
  );
  if (!structural.ok) {
    for (const e of structural.errors)
      console.log(`  linha ${e.line ?? '?'}: ${e.message}`);
    process.exit(1);
  }

  // 2. Real signature, then the enviNFe batch (indSinc=1) against its XSD.
  const signed = new SefazXmlSigner().sign(nfeXml, 'infNFe', certificate);
  const envi =
    '<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>' +
    signed +
    '</enviNFe>';
  const batch = await validator.validate(envi, 'enviNFe');
  console.log(`[spike] XSD do enviNFe assinado: ${batch.ok ? 'ok' : 'FALHOU'}`);
  if (!batch.ok) {
    for (const e of batch.errors)
      console.log(`  linha ${e.line ?? '?'}: ${e.message}`);
    process.exit(1);
  }
  console.log(
    `[spike] chave=${accessKey} nNF=${number} serie=${series} UF=${uf}`,
  );
  if (dry) {
    console.log('[spike] DRY RUN: nada foi enviado.');
    return;
  }

  // 3. Send.
  const endpoint = resolver.resolve({
    uf,
    tpAmb,
    model: 55,
    tpEmis: 1,
    service: 'NfeAutorizacao',
  });
  const answer = await soap.call({
    endpoint,
    bodyXml: envi,
    certificate,
    timeoutMs: 60_000,
  });
  if (answer.kind !== 'ok') {
    console.log(
      `[spike] transporte: ${answer.kind}${answer.kind === 'uncertain' ? ` (${answer.reason})` : ''}`,
    );
    process.exit(1);
  }
  const parsed = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    ignoreAttributes: true,
  }).parse(answer.bodyXml) as {
    retEnviNFe?: {
      cStat?: string;
      xMotivo?: string;
      protNFe?: { infProt?: Record<string, string> };
    };
  };
  const lote = parsed.retEnviNFe;
  console.log(
    `[spike] lote: cStat=${lote?.cStat ?? '?'} xMotivo="${lote?.xMotivo ?? ''}"`,
  );
  const prot = lote?.protNFe?.infProt;
  if (prot) {
    console.log(
      `[spike] nota: cStat=${prot.cStat} (${classifyCstat(prot.cStat)}) xMotivo="${prot.xMotivo}" nProt=${prot.nProt ?? '-'} chNFe=${prot.chNFe ?? '-'}`,
    );
  }
  console.log(`[spike] tempo da chamada: ${answer.durationMs} ms`);
  process.exit(prot && classifyCstat(prot.cStat) === 'authorized' ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(
    `Falhou: ${error instanceof Error ? error.name + ': ' + error.message : 'erro desconhecido'}`,
  );
  process.exit(1);
});
