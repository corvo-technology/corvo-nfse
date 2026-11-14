import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import forge from 'node-forge';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(root, '.env.api-smoke.local'), quiet: true });

if (process.argv.includes('--help')) {
  console.log(`Teste NFS-e pela API key (somente test)

  yarn test:api-key
  yarn test:api-key --resume=tmp/api-key-smoke/<execucao>
  yarn test:api-key --no-email

Configuração: .env.api-smoke.local (veja scripts/api-key-smoke.env.example).
Um novo comando emite uma nova nota; --resume mantém a nota/idempotência.
PDF, XML, requisições e resumo ficam em tmp/api-key-smoke/<execucao>.
Sem --no-email, envia um email real de teste para CORVO_CUSTOMER_EMAIL.`);
  process.exit(0);
}

const apiKey = process.env.CORVO_API_KEY?.trim();
const password = process.env.CORVO_CERTIFICATE_PASSWORD;
const baseUrl = new URL(
  process.env.CORVO_API_BASE_URL ?? 'http://localhost:3000/v1',
);
baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/`;
const certificatePath = resolve(
  (
    process.env.CORVO_CERTIFICATE_PATH ??
    '~/Downloads/certificado_empresa_teste.p12'
  ).replace(/^~(?=\/)/, homedir()),
);
const email = process.env.CORVO_CUSTOMER_EMAIL ?? 'maria99@example.com';
const sendEmail = !process.argv.includes('--no-email');
const timeoutMs = Number(process.env.CORVO_SMOKE_TIMEOUT_SECONDS ?? 300) * 1000;
const resume = process.argv
  .find((arg) => arg.startsWith('--resume='))
  ?.slice(9);
const runDirectory = resume
  ? resolve(root, resume)
  : resolve(
      root,
      'tmp/api-key-smoke',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
    );
const statePath = resolve(runDirectory, 'state.json');
let state;
const httpLog = [];

function redact(value) {
  let text = String(value);
  for (const secret of [apiKey, password])
    if (secret) text = text.replaceAll(secret, '[REDACTED]');
  return text.replace(/corvo_(?:live|test)_[a-f0-9]{40}/g, '[REDACTED]');
}

function save(name, value) {
  writeFileSync(
    resolve(runDirectory, name),
    JSON.stringify(value, null, 2) + '\n',
    { mode: 0o600 },
  );
}

function checkpoint() {
  save('state.json', state);
  save('http.json', httpLog);
}

function resource(data) {
  return data;
}

function ensureTest(value, label) {
  if (value?.environment !== 'test')
    throw new Error(
      `${label} retornou ambiente diferente de test; fluxo interrompido.`,
    );
}

async function request(
  path,
  { method = 'GET', json, form, headers = {}, binary = false } = {},
) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        'x-api-key': apiKey,
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    httpLog.push({
      method,
      path,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    });
    if (response.status === 429 && attempt < 3) {
      const wait = Number(response.headers.get('retry-after') ?? 60);
      if (!Number.isFinite(wait) || wait < 0 || wait > 120)
        throw new Error(
          'Rate limit: Retry-After inválido ou maior que 120 segundos.',
        );
      await response.arrayBuffer();
      console.log(`Rate limit: aguardando ${wait}s.`);
      await sleep(Math.max(1, wait) * 1000);
      continue;
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        redact(`${method} ${path}: HTTP ${response.status}\n${body}`),
      );
    }
    if (binary)
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        type: response.headers.get('content-type'),
      };
    const body = await response.json();
    if (!Object.hasOwn(body, 'data'))
      throw new Error(`Contrato inválido em ${method} ${path}: data ausente.`);
    return body;
  }
}

async function collection(path, { limit = 50, stopAt } = {}) {
  const items = [];
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL(path, baseUrl);
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);
    const relative = url.pathname.slice(baseUrl.pathname.length) + url.search;
    const page = await request(relative);
    const pagination = page.pagination;
    if (
      !Array.isArray(page.data) ||
      page.data.length > limit ||
      pagination?.limit !== limit ||
      typeof pagination.hasMore !== 'boolean'
    ) {
      throw new Error(`Contrato de paginação inválido em ${path}.`);
    }
    if (
      (!pagination.hasMore && pagination.nextCursor !== null) ||
      (pagination.hasMore &&
        (typeof pagination.nextCursor !== 'string' || !pagination.nextCursor))
    ) {
      throw new Error(`Cursor inválido em ${path}.`);
    }
    items.push(...page.data.map(resource));
    if (stopAt && items.some(stopAt)) return items;
    if (!pagination.hasMore) return items;
    cursor = pagination.nextCursor;
    if (cursors.has(cursor) || cursors.size >= 1000)
      throw new Error(`Paginação não avança em ${path}.`);
    cursors.add(cursor);
  } while (true);
}

async function waitForInvoice(phase, ready) {
  const deadline = Date.now() + timeoutMs;
  let lastState;
  while (Date.now() < deadline) {
    const invoice = resource(
      (await request(`invoices/${state.invoiceId}`)).data,
    );
    ensureTest(invoice, 'Nota');
    save('invoice.json', invoice);
    const progress = `${invoice.status} / documentos=${invoice.documentsStatus} / email=${invoice.emailStatus ?? '-'}`;
    if (progress !== lastState) console.log(`  ${phase}: ${progress}`);
    lastState = progress;
    if (['rejected', 'failed', 'manual_review'].includes(invoice.status)) {
      throw new Error(
        `${phase}: nota em ${invoice.status}. ${redact(invoice.lastErrorCode ?? '')} ${redact(invoice.lastErrorMessage ?? '')}`,
      );
    }
    if (ready(invoice)) return invoice;
    await sleep(2000);
  }
  throw new Error(
    `${phase}: timeout de ${timeoutMs / 1000}s. Confira worker, Redis e storage. Retome com --resume=${runDirectory}.`,
  );
}

function validateDocument(format, bytes, type) {
  if (
    format === 'pdf' &&
    (!type?.includes('application/pdf') ||
      !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
  ) {
    throw new Error('Download PDF não retornou um PDF válido.');
  }
  if (format === 'xml') {
    const xml = bytes.toString('utf8');
    if (
      !type?.includes('xml') ||
      !/<NFSe(?:\s|>)/.test(xml) ||
      !xml.includes('SIMULATION')
    )
      throw new Error('Download XML não retornou a NFS-e simulada esperada.');
    if (!xml.includes('41834687000148'))
      throw new Error('XML não contém o CNPJ da empresa de teste.');
  }
}

async function run() {
  if (!/^corvo_test_[a-f0-9]{40}$/.test(apiKey ?? ''))
    throw new Error(
      'Configure uma API key corvo_test_ válida em CORVO_API_KEY.',
    );
  if (!password) throw new Error('Configure CORVO_CERTIFICATE_PASSWORD.');
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  )
    throw new Error('CORVO_API_BASE_URL inválida.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000)
    throw new Error('CORVO_SMOKE_TIMEOUT_SECONDS deve ser positivo.');
  if (resume && !existsSync(statePath))
    throw new Error(
      '--resume deve apontar para uma execução existente com state.json.',
    );
  const p12Buffer = readFileSync(certificatePath);
  if (p12Buffer.subarray(0, 5).toString() === '%PDF-')
    throw new Error(
      'O certificado informado é PDF. Use o arquivo PKCS#12 (.p12/.pfx).',
    );
  if (p12Buffer.length > 50 * 1024)
    throw new Error('Certificado maior que o limite de 50 KB.');
  const asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  const bags = (oid) => p12.getBags({ bagType: oid })[oid] ?? [];
  const key = [
    ...bags(forge.pki.oids.pkcs8ShroudedKeyBag),
    ...bags(forge.pki.oids.keyBag),
  ].find((bag) => bag.key)?.key;
  const cert = bags(forge.pki.oids.certBag).find(
    (bag) => key && bag.cert?.publicKey?.n?.equals(key.n),
  )?.cert;
  if (
    !cert ||
    cert.validity.notBefore > new Date() ||
    cert.validity.notAfter < new Date()
  )
    throw new Error(
      'Certificado sem chave correspondente ou fora da validade.',
    );
  const fingerprint = forge.md.sha1
    .create()
    .update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
    .digest()
    .toHex()
    .toUpperCase();

  mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  state = resume
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : {
        runId: randomUUID(),
        baseUrl: baseUrl.toString(),
        customerEmail: email,
        sendEmail,
      };
  const previousHttpPath = resolve(runDirectory, 'http.json');
  if (resume && existsSync(previousHttpPath)) {
    httpLog.push(...JSON.parse(readFileSync(previousHttpPath, 'utf8')));
  }
  if (
    state.baseUrl !== baseUrl.toString() ||
    state.customerEmail !== email ||
    state.sendEmail !== sendEmail
  )
    throw new Error(
      'Para retomar, mantenha a URL, o destinatário e a opção de email da execução original.',
    );
  checkpoint();
  console.log(
    `API: ${baseUrl}\nExecução: ${runDirectory}\nEmail: ${sendEmail ? email : 'desabilitado'}`,
  );

  console.log(
    '1. Criando ou localizando empresa pelo CNPJ no tenant da API key.',
  );
  const companyInput = {
    legalName: 'Empresa Exemplo Tecnologia LTDA',
    tradeName: 'Empresa Exemplo TESTE',
    taxId: '41.834.687/0001-48',
    municipalReg: '123456',
    municipalityCode: '3170206',
    defaultServiceCode: '010101',
    taxRegime: 'Simples Nacional',
    simpleNational: true,
    address: {
      street: 'Rua Exemplo de Testes',
      number: '100',
      district: 'Centro',
      city: 'Uberlândia',
      state: 'MG',
      zip: '38400-000',
    },
  };
  save('company-request.json', companyInput);
  let company;
  if (state.companyId)
    company = resource((await request(`companies/${state.companyId}`)).data);
  else {
    const found = (
      await collection('companies', {
        stopAt: (item) => item.taxId === '41834687000148',
      })
    ).find((item) => item.taxId === '41834687000148');
    company =
      found ??
      resource(
        (await request('companies', { method: 'POST', json: companyInput }))
          .data,
      );
  }
  ensureTest(company, 'Empresa');
  if (company.taxId !== '41834687000148')
    throw new Error('Empresa retornou CNPJ diferente do solicitado.');
  if (
    !state.invoiceRequest &&
    (company.defaultServiceCode !== companyInput.defaultServiceCode ||
      company.municipalityCode !== companyInput.municipalityCode)
  ) {
    company = resource(
      (
        await request(`companies/${company.id}`, {
          method: 'PATCH',
          json: {
            defaultServiceCode: companyInput.defaultServiceCode,
            municipalityCode: companyInput.municipalityCode,
          },
        })
      ).data,
    );
  }
  state.companyId = company.id;
  save('company.json', company);
  checkpoint();
  console.log(`  Empresa: ${company.id}`);

  console.log('2. Subindo ou confirmando o certificado de teste.');
  const existingCert = (
    await collection(`companies/${company.id}/certificates`)
  ).find(
    (item) => item.fingerprint === fingerprint && item.status === 'active',
  );
  if (existingCert) {
    state.certificateId = existingCert.id;
    save('certificate.json', existingCert);
  } else {
    const form = new FormData();
    form.set(
      'file',
      new Blob([p12Buffer], { type: 'application/x-pkcs12' }),
      basename(certificatePath),
    );
    form.set('password', password);
    const uploaded = (
      await request(`companies/${company.id}/certificates`, {
        method: 'POST',
        form,
      })
    ).data;
    if (uploaded.status !== 'active' || uploaded.fingerprint !== fingerprint)
      throw new Error('Upload não retornou o certificado ativo esperado.');
    state.certificateId = uploaded.id;
    save('certificate.json', uploaded);
  }
  company = (await request(`companies/${company.id}`)).data;
  ensureTest(company, 'Empresa');
  if (company.status !== 'ready')
    throw new Error(
      `Empresa não ficou pronta: ${company.status}, pendências=${JSON.stringify(company.setupGaps)}.`,
    );
  save('company.json', company);
  checkpoint();

  console.log('3. Emitindo nota simulada e verificando idempotência.');
  state.invoiceRequest ??= {
    companyTaxId: company.taxId,
    externalId: `api-smoke-${state.runId}`,
    customer: {
      name: 'Cliente Fictício de Testes',
      taxId: '529.982.247-25',
      email,
      address: {
        street: 'Rua Cliente de Testes, 200',
        city: 'Uberlândia',
        state: 'MG',
        zip: '38400-000',
        country: 'BR',
      },
    },
    service: {
      description:
        'Serviço fictício de desenvolvimento de software — teste de integração Corvo',
    },
    amount: 150.5,
    competenceDate: new Date().toISOString().slice(0, 10),
    options: { email: { send: false } },
  };
  save('invoice-request.json', state.invoiceRequest);
  checkpoint();
  const emission = {
    method: 'POST',
    json: state.invoiceRequest,
    headers: { 'idempotency-key': `smoke-${state.runId}` },
  };
  if (!state.invoiceId) {
    const invoice = resource((await request('invoices', emission)).data);
    ensureTest(invoice, 'Nota');
    state.invoiceId = invoice.id;
    checkpoint();
  }
  const repeated = resource((await request('invoices', emission)).data);
  if (repeated.id !== state.invoiceId)
    throw new Error('Idempotência não recuperou a mesma nota.');
  console.log(`  Nota: ${state.invoiceId}`);

  console.log(
    '4. Aguardando autorização simulada e preparação dos documentos.',
  );
  const invoice = await waitForInvoice(
    'Emissão',
    (item) =>
      item.status === 'authorized' &&
      item.documentsStatus === 'ready' &&
      item.documentsReadyAt,
  );
  const listed = await collection(
    `invoices?companyId=${company.id}&externalId=${encodeURIComponent(state.invoiceRequest.externalId)}`,
    { limit: 1 },
  );
  if (!listed.some((item) => item.id === state.invoiceId))
    throw new Error('Nota ausente na listagem por empresa/externalId.');
  const events = await collection(`invoices/${state.invoiceId}/events`, {
    limit: 1,
  });
  save('events.json', events);
  console.log(`  ${events.length} eventos percorridos com cursor e limit=1.`);

  console.log('5. Baixando PDF/XML pela API e pelas URLs assinadas.');
  state.downloads = {};
  for (const format of ['pdf', 'xml']) {
    const direct = await request(`invoices/${state.invoiceId}/${format}`, {
      binary: true,
    });
    validateDocument(format, direct.bytes, direct.type);
    const filename = `nfse-${invoice.nfseNumber ?? state.invoiceId}.${format}`;
    writeFileSync(resolve(runDirectory, filename), direct.bytes, {
      mode: 0o600,
    });
    const signed = (
      await request(`invoices/${state.invoiceId}/download-url`, {
        method: 'POST',
        json: { format },
      })
    ).data;
    const response = await fetch(signed.downloadUrl, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Download assinado ${format}: HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    validateDocument(format, bytes, response.headers.get('content-type'));
    if (!bytes.equals(direct.bytes))
      throw new Error(`Download assinado ${format} diverge da API.`);
    state.downloads[format] = {
      file: filename,
      bytes: bytes.length,
      signedDownloadVerified: true,
      expiresAt: signed.expiresAt,
    };
    console.log(
      `  ${filename}: ${bytes.length} bytes; download assinado conferido.`,
    );
  }
  checkpoint();

  if (sendEmail) {
    console.log(`6. Solicitando email de teste para ${email}.`);
    const queued = (
      await request(`invoices/${state.invoiceId}/email`, {
        method: 'POST',
        headers: { 'idempotency-key': `smoke-email-${state.runId}` },
      })
    ).data;
    save('email-request.json', queued);
    const sent = await waitForInvoice('Email', (item) => {
      if (item.emailStatus === 'failed')
        throw new Error(
          'Envio de email falhou; confira o worker nfse-email e a configuração MillionSend.',
        );
      return item.emailStatus === 'sent' && item.lastEmailSentAt;
    });
    state.emailStatus = sent.emailStatus;
    state.emailSentAt = sent.lastEmailSentAt;
  }
  delete state.lastFailure;
  state.completedAt = new Date().toISOString();
  checkpoint();
  save('summary.json', {
    environment: 'test',
    baseUrl: state.baseUrl,
    companyId: state.companyId,
    certificateId: state.certificateId,
    invoiceId: state.invoiceId,
    nfseNumber: invoice.nfseNumber,
    status: invoice.status,
    downloads: state.downloads,
    customerEmail: email,
    emailStatus: state.emailStatus ?? 'not_requested',
    emailSentAt: state.emailSentAt ?? null,
    completedAt: state.completedAt,
  });
  console.log(
    `Fluxo concluído. Resultado: ${resolve(runDirectory, 'summary.json')}`,
  );
}

run().catch(async (error) => {
  const message = redact(error.message ?? error);
  console.error(`Falha: ${message}`);
  if (state) {
    state.lastFailure = { message, at: new Date().toISOString() };
    checkpoint();
    if (state.invoiceId) {
      try {
        save(
          'events.json',
          await collection(`invoices/${state.invoiceId}/events`),
        );
      } catch {
        /* Keep the original failure. */
      }
    }
    console.error(
      `Artefatos: ${runDirectory}\nRetomar: yarn test:api-key --resume=${runDirectory}`,
    );
  }
  process.exitCode = 1;
});
