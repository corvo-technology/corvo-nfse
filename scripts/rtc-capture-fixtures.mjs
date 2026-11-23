// Reexecuta os passos de docs/fiscal/rtc/fixtures/*.json contra uma calculadora RTC no ar
// e regrava as respostas e a versão capturada. Os campos `expected` NÃO são tocados: revise o diff.
// Uso: RTC_URL=http://localhost:18080/api node scripts/rtc-capture-fixtures.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';

const base = (process.env.RTC_URL ?? '').replace(/\/$/, '');
if (!base) throw new Error('Informe RTC_URL, ex.: RTC_URL=http://localhost:18080/api');
const dir = new URL('../docs/fiscal/rtc/fixtures/', import.meta.url);

const call = async (step) => {
  const res = await fetch(`${base}${step.path}`, {
    method: step.method,
    headers: step.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: step.method === 'POST' ? JSON.stringify(step.request) : undefined,
  });
  return { status: res.status, response: await res.json() };
};

const version = (await call({ method: 'GET', path: '/calculadora/dados-abertos/versao' })).response;
console.log(`Calculadora: ${version.versaoApp}/${version.versaoDb} (${version.dataVersaoDb})`);

for (const name of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
  const url = new URL(name, dir);
  const fixture = JSON.parse(await readFile(url, 'utf8'));
  for (const step of fixture.steps) {
    const { status, response } = await call(step);
    if (status !== step.status) console.log(`  ${name}: status ${step.status} -> ${status}`);
    step.status = status;
    step.response = response;
  }
  fixture.capturedAt = new Date().toISOString().slice(0, 10);
  fixture.calculator = {
    app: version.versaoApp,
    db: version.versaoDb,
    dbDate: version.dataVersaoDb,
    source: `deploy/Dockerfile.rtc (repositório oficial, tag ${version.versaoApp})`,
  };
  await writeFile(url, `${JSON.stringify(fixture, null, 1)}\n`);
  console.log(`ok ${name}`);
}
