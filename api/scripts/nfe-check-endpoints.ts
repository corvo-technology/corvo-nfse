/**
 * Manual check of the NF-e endpoints of every authority (homologação by default).
 *
 * Without certificate: only DNS + TCP + TLS reachability of the NfeStatusServico4 host.
 *   yarn ts-node -r tsconfig-paths/register scripts/nfe-check-endpoints.ts
 *
 * With certificate: also calls NfeStatusServico4 (SOAP 1.2 + mTLS) and prints cStat/xMotivo.
 *   NFE_SPIKE_PFX_PATH=/caminho/empresa.pfx NFE_SPIKE_PFX_PASSWORD='...' \
 *     yarn ts-node -r tsconfig-paths/register scripts/nfe-check-endpoints.ts
 *
 * Optional: NFE_CHECK_TP_AMB=1 checks produção (status query only, no document is sent);
 * NFE_CHECK_ONLY=SP,SVRS limits the authorities.
 *
 * Prints only authority, host, timings, cStat and xMotivo. Never the PFX, the password or any XML.
 */
import { readFileSync } from 'node:fs';
import { connect } from 'node:tls';
import { loadCertificate } from '../src/infra/external/nfe/sefaz/certificate-loader';
import { ENDPOINTS } from '../src/infra/external/nfe/sefaz/endpoints';
import { NfeGateway } from '../src/infra/external/nfe/sefaz/nfe-gateway';
import { UF_TABLE } from '../src/infra/external/nfe/sefaz/uf';
import type {
  AuthorityId,
  Uf,
} from '../src/modules/fiscal-core/domain/ports/authority.port';
import type { LoadedCertificate } from '../src/modules/fiscal-core/domain/ports/xml.port';
import { buildSpikeClients } from './lib/nfe-spike-common';

const TIMEOUT_MS = 15_000;

/** A UF that the authority serves, used to build the status request. */
function representativeUf(authority: AuthorityId): Uf {
  const found = (Object.keys(UF_TABLE) as Uf[]).find(
    (uf) => UF_TABLE[uf].authorizer55 === authority,
  );
  if (!found) throw new Error(`Nenhuma UF usa a autoridade ${authority}`);
  return found;
}

function probeTls(host: string): Promise<string> {
  return new Promise((resolve) => {
    const started = Date.now();
    const done = (text: string) =>
      resolve(`${text} (${Date.now() - started} ms)`);
    // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification -- manual script: alcançabilidade apenas, nada é enviado
    const socket = connect({
      host,
      port: 443,
      servername: host,
      // Reachability only: the ICP-Brasil chain is not in Node's default store, and nothing is sent.
      rejectUnauthorized: false,
      timeout: TIMEOUT_MS,
    });
    socket.once('secureConnect', () => {
      socket.destroy();
      done('TLS ok');
    });
    socket.once('timeout', () => {
      socket.destroy();
      done('timeout');
    });
    socket.once('error', (e: NodeJS.ErrnoException) => {
      socket.destroy();
      const code = e.code ?? e.name;
      // A TLS alert means the server answered (it usually asks for the client certificate).
      done(
        code.startsWith('ERR_SSL')
          ? `alcançou (alerta TLS, exige certificado de cliente)`
          : `FALHOU: ${code}`,
      );
    });
  });
}

function loadOptionalCertificate(): LoadedCertificate | undefined {
  const path = process.env.NFE_SPIKE_PFX_PATH;
  const password = process.env.NFE_SPIKE_PFX_PASSWORD;
  if (!path || !password) return undefined;
  return loadCertificate(readFileSync(path), password);
}

async function main(): Promise<void> {
  const tpAmb = process.env.NFE_CHECK_TP_AMB === '1' ? 1 : 2;
  const only = process.env.NFE_CHECK_ONLY?.split(',').map((s) =>
    s.trim().toUpperCase(),
  );
  const certificate = loadOptionalCertificate();
  const { soap, resolver, validator } = buildSpikeClients();
  const gateway = new NfeGateway(soap, resolver, validator, TIMEOUT_MS);

  console.log(
    `NF-e tpAmb=${tpAmb} ${certificate ? 'com certificado (status via SOAP)' : 'sem certificado (só TCP/TLS)'}\n`,
  );
  const rows: string[][] = [
    ['AUTORIDADE', 'UF USADA', 'HOST', 'TLS', 'STATUS'],
  ];
  const authorities = [
    ...new Set(
      ENDPOINTS.filter((e) => e.tpAmb === tpAmb).map((e) => e.authority),
    ),
  ].filter((a) => !only || only.includes(a));

  for (const authority of authorities) {
    const uf = representativeUf(authority);
    const endpoint = resolver.resolve({
      uf,
      tpAmb,
      model: 55,
      tpEmis: 1,
      service: 'NfeStatusServico',
    });
    const host = new URL(endpoint.url).host;
    const tls = await probeTls(host);
    let status = '-';
    if (certificate) {
      const started = Date.now();
      try {
        const out = await gateway.queryStatus({ uf, tpAmb, certificate });
        status =
          out.kind === 'ok'
            ? `cStat=${out.value.cStat} "${out.value.xMotivo}" up=${out.value.up}`
            : `resultado=${out.kind}`;
      } catch (error) {
        // Our own errors never carry secrets (see certificate-loader).
        status = `erro: ${error instanceof Error ? error.name : 'desconhecido'}`;
      }
      status += ` (${Date.now() - started} ms)`;
    }
    rows.push([authority, uf, host, tls, status]);
  }

  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((r) => r[i].length)),
  );
  for (const r of rows)
    console.log(
      r
        .map((c, i) => c.padEnd(widths[i]))
        .join('  ')
        .trimEnd(),
    );

  console.log(
    '\nContingência: SVC-AN e SVC-RS usam os mesmos endereços de SVAN e SVRS.',
  );
}

main().catch((error: unknown) => {
  console.error(
    `Falhou: ${error instanceof Error ? error.name + ': ' + error.message : 'erro desconhecido'}`,
  );
  process.exit(1);
});
