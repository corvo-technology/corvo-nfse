// Cenários fiscais pela API (somente chave corvo_test_): cria empresas de vários
// regimes/municípios, calcula e emite notas e imprime uma tabela de resultados.
//
//   CORVO_API_KEY=corvo_test_... node scripts/api-scenarios.mjs [--no-emit] [--only=mei]
//
// Variáveis: CORVO_API_BASE_URL (padrão http://localhost:3000/v1),
// CORVO_SCENARIO_TIMEOUT_SECONDS (padrão 60). Nenhuma chave é gravada em disco.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const apiKey = process.env.CORVO_API_KEY?.trim() ?? '';
if (!/^corvo_test_[a-f0-9]{40}$/.test(apiKey))
  throw new Error('Defina CORVO_API_KEY com uma chave corvo_test_ válida.');
const base = (process.env.CORVO_API_BASE_URL ?? 'http://localhost:3000/v1').replace(/\/+$/, '');
const timeoutMs = Number(process.env.CORVO_SCENARIO_TIMEOUT_SECONDS ?? 60) * 1000;
const emit = !process.argv.includes('--no-emit');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const EMAIL = 'pedrook16@gmail.com';

const redact = (text) => String(text).replaceAll(apiKey, '[REDACTED]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cnpj(base12) {
  const digits = base12.split('').map(Number);
  const dv = (len) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = digits.slice(0, len).reduce((acc, d, i) => acc + d * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  digits.push(dv(12));
  digits.push(dv(13));
  return digits.join('');
}

async function api(method, path, { json, headers = {} } = {}) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: { 'x-api-key': apiKey, ...(json ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { status: response.status, body, retryAfter: response.headers.get('retry-after') };
}

const COMPANIES = [
  { key: 'mei', cnpj: cnpj('110000010001'), legalName: 'Barbearia Teste MEI', taxRegime: 'MEI', municipalityCode: '3550308', defaultServiceCode: '060101', city: ['São Paulo', 'SP'] },
  { key: 'simples-sp', cnpj: cnpj('110000020001'), legalName: 'Consultoria Teste Simples SP', taxRegime: 'Simples Nacional', municipalityCode: '3550308', defaultServiceCode: '010601', city: ['São Paulo', 'SP'] },
  { key: 'simples-udi', cnpj: cnpj('110000030001'), legalName: 'Tecnologia Teste Simples Uberlandia', taxRegime: 'Simples Nacional', municipalityCode: '3170206', defaultServiceCode: '010201', city: ['Uberlândia', 'MG'] },
  { key: 'presumido-sp', cnpj: cnpj('110000040001'), legalName: 'Servicos Teste Presumido SP', taxRegime: 'Lucro Presumido', municipalityCode: '3550308', defaultServiceCode: '010601', city: ['São Paulo', 'SP'], serviceProfile: true },
];

const CUSTOMERS = {
  none: undefined,
  cpf: { name: 'Cliente Pessoa Física Teste', taxId: '52998224725', email: EMAIL },
  cnpj: { name: 'Cliente Empresa Teste Ltda', taxId: '11222333000181', email: EMAIL },
};
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const SCENARIOS = [
  { name: 'sem tomador', customer: 'none', amount: 50 },
  { name: 'tomador CPF', customer: 'cpf', amount: 120.5 },
  { name: 'tomador CNPJ', customer: 'cnpj', amount: 1000 },
  { name: 'com desconto', customer: 'cpf', amount: 200, discount: 20 },
  { name: 'agendada (+3 dias)', customer: 'cpf', amount: 80, schedule: 3, noWait: true },
  { name: 'CPF inválido (espera 422)', customer: 'cpf', amount: 10, badTaxId: true, expectHttp: 422 },
  { name: 'data futura sem SCHEDULE (calc ok, POST 422)', customer: 'cpf', amount: 10, futureNoSchedule: true, expectPostHttp: 422 },
];

async function ensureCompany(spec) {
  const list = await api('GET', 'companies?limit=100');
  const found = list.body.data?.find((c) => c.taxId === spec.cnpj);
  if (found) return found;
  const created = await api('POST', 'companies', {
    json: {
      legalName: spec.legalName,
      taxId: spec.cnpj,
      taxRegime: spec.taxRegime,
      municipalityCode: spec.municipalityCode,
      defaultServiceCode: spec.defaultServiceCode,
      municipalReg: '123456',
      address: { street: 'Rua Teste', number: '100', district: 'Centro', city: spec.city[0], state: spec.city[1], zip: '01001000' },
    },
  });
  if (created.status !== 201) throw new Error(`Empresa ${spec.key}: HTTP ${created.status} ${redact(JSON.stringify(created.body))}`);
  return created.body.data;
}

async function ensureServiceProfile(company, spec) {
  const list = await api('GET', `companies/${company.id}/service-tax-profiles?date=${today}`);
  let profile = list.body.data?.find((p) => p.serviceCode === spec.defaultServiceCode);
  if (!profile) {
    // Códigos reais do fixture ok-consultoria-2026; ISS 3% é valor de cenário de teste, não alíquota municipal.
    const created = await api('POST', `companies/${company.id}/service-tax-profiles`, {
      json: {
        name: 'Consultoria TI - cenário de teste', serviceCode: spec.defaultServiceCode, nbsCode: '115011000', cst: '000', classCode: '000001',
        operationIndicator: '100301', operationNature: 'SERVICE', regimeApplicability: ['LUCRO_PRESUMIDO'], incidenceMunicipalityCode: spec.municipalityCode,
        issTaxation: 'NORMAL', issRate: '3.00', withholdingPolicy: 'NONE_CONFIRMED', effectiveFrom: '2026-01-01', classificationSource: 'manual',
      },
    });
    if (created.status !== 201) throw new Error(`Perfil de serviço: HTTP ${created.status} ${redact(JSON.stringify(created.body))}`);
    profile = created.body.data;
  }
  if (profile.reviewStatus !== 'approved') {
    const approved = await api('POST', `companies/${company.id}/service-tax-profiles/${profile.id}/approve`);
    if (approved.status !== 201) throw new Error(`Aprovação do perfil: HTTP ${approved.status} ${redact(JSON.stringify(approved.body))}`);
  }
}

function payload(company, scenario) {
  const customer = CUSTOMERS[scenario.customer];
  return {
    companyId: company.id,
    externalId: `scenario-${company.taxId}-${scenario.name}`.slice(0, 80),
    ...(customer ? { customer: scenario.badTaxId ? { ...customer, taxId: '11111111111' } : customer } : {}),
    service: { description: `Servico de teste (${scenario.name})` },
    amount: scenario.amount,
    ...(scenario.discount ? { discount: scenario.discount } : {}),
    competenceDate: scenario.schedule ? inDays(scenario.schedule) : scenario.futureNoSchedule ? inDays(3) : today,
    ...(scenario.schedule ? { options: { type: 'SCHEDULE', email: { send: false } } } : { options: { email: { send: false } } }),
  };
}

async function waitInvoice(id) {
  const deadline = Date.now() + timeoutMs;
  let last = 'queued';
  while (Date.now() < deadline) {
    const got = await api('GET', `invoices/${id}`);
    const props = got.body.data?.props ?? got.body.data ?? {};
    last = props.status ?? last;
    if (['authorized', 'rejected', 'failed', 'manual_review', 'reconciliation_required'].includes(last))
      return { status: last, props };
    await sleep(1500);
  }
  return { status: `${last} (timeout)`, props: {} };
}

const rows = [];
for (const spec of COMPANIES) {
  if (only && spec.key !== only) continue;
  const company = await ensureCompany(spec);
  if (spec.serviceProfile) await ensureServiceProfile(company, spec);
  console.log(`\n== ${spec.key}: ${company.legalName} (${company.taxId}) status=${company.status} regime=${company.taxRegime}`);
  for (const scenario of SCENARIOS) {
    const body = payload(company, scenario);
    const calc = await api('POST', 'invoices/calculate', { json: body });
    const c = calc.body.data;
    const calcText = calc.status === 200
      ? `${c.status}${c.blocking ? ` ${c.blocking.code}` : ''} net=${c.netReceivableAmount}`
      : `HTTP ${calc.status} ${calc.body.code ?? ''}`;
    let emitText = '-';
    if (emit) {
      if (scenario.expectHttp || scenario.expectPostHttp || calc.status === 200 && c.status === 'ready') {
        const sent = await api('POST', 'invoices', { json: body, headers: { 'idempotency-key': `scn-${randomUUID()}` } });
        if (sent.status === 202) {
          const id = sent.body.data?.props?.id;
          if (scenario.noWait) emitText = `202 ${sent.body.data.props.status} scheduledFor=${sent.body.data.props.scheduledFor}`;
          else { const done = await waitInvoice(id); emitText = `${done.status}${done.props.lastErrorCode ? ` ${done.props.lastErrorCode}` : ''}`; }
        } else emitText = `HTTP ${sent.status} ${sent.body.code ?? ''}${sent.body.details?.[0]?.code ? ` ${sent.body.details[0].code}` : ''}`;
      } else emitText = 'não emitida (cálculo bloqueado)';
    }
    const expected = scenario.expectHttp
      ? (calc.status === scenario.expectHttp ? 'OK' : `ESPERAVA ${scenario.expectHttp}`)
      : scenario.expectPostHttp
        ? (emitText.startsWith(`HTTP ${scenario.expectPostHttp}`) ? 'OK' : `ESPERAVA POST ${scenario.expectPostHttp}`)
        : '';
    rows.push({ empresa: spec.key, cenario: scenario.name, calculo: calcText, emissao: emitText, obs: expected });
    console.log(`  ${scenario.name.padEnd(38)} calc: ${calcText.padEnd(44)} emissão: ${emitText} ${expected}`);
  }
}

const dir = resolve(import.meta.dirname, '../tmp/api-scenarios');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), redact(JSON.stringify(rows, null, 2)));
console.log(`\n${rows.length} cenários executados. Resultado salvo em tmp/api-scenarios/.`);
