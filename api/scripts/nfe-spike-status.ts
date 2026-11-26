/**
 * Manual spike: NfeStatusServico4 in homologação (SOAP 1.2 + mTLS with the A1).
 *
 *   NFE_SPIKE_PFX_PATH=... NFE_SPIKE_PFX_PASSWORD=... NFE_SPIKE_UF=SP \
 *     yarn ts-node -r tsconfig-paths/register scripts/nfe-spike-status.ts
 *
 * Prints only cStat, xMotivo, tMed and the duration. Never the PFX, the password or any XML.
 */
import { NfeGateway } from '../src/infra/external/nfe/sefaz/nfe-gateway';
import {
  assertHomologacaoOnly,
  buildSpikeClients,
  loadSpikeCertificate,
  spikeUf,
} from './lib/nfe-spike-common';

async function main(): Promise<void> {
  const tpAmb = assertHomologacaoOnly();
  const uf = spikeUf();
  const certificate = loadSpikeCertificate();
  const { soap, resolver, validator } = buildSpikeClients();
  const gateway = new NfeGateway(soap, resolver, validator, 30_000);

  const started = Date.now();
  const outcome = await gateway.queryStatus({ uf, tpAmb, certificate });
  const ms = Date.now() - started;

  if (outcome.kind === 'ok') {
    const { cStat, xMotivo, tMed, up } = outcome.value;
    console.log(
      `[status ${uf}] cStat=${cStat} xMotivo="${xMotivo}" tMed=${tMed ?? '-'} up=${up} (${ms} ms)`,
    );
    process.exit(up ? 0 : 1);
  }
  console.log(`[status ${uf}] resultado=${outcome.kind} (${ms} ms)`);
  process.exit(1);
}

main().catch((error: unknown) => {
  // The message of our own errors never carries secrets (see certificate-loader).
  console.error(
    `Falhou: ${error instanceof Error ? error.name + ': ' + error.message : 'erro desconhecido'}`,
  );
  process.exit(1);
});
