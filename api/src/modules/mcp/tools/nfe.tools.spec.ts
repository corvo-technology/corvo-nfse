import 'reflect-metadata';
import { UnprocessableEntityException } from '@nestjs/common';
import type { AuthContext } from '@/modules/auth/auth-context';
import { McpServer } from '../mcp.server';
import { McpNfe } from './nfe-access';
import {
  NFE_CORRECT_TOOL,
  NFE_INUTILIZE_TOOL,
  NFE_NUMBER_GAPS_TOOL,
  NFE_SETTINGS_GET_TOOL,
  NFE_SETTINGS_UPDATE_TOOL,
  NFE_VALIDATE_TOOL,
  byType,
  createAllListHandler,
  createNfeCancelHandler,
  createNfeCorrectHandler,
  createNfeDownloadPdfHandler,
  createNfeEmailResendHandler,
  createNfeRepeatHandler,
  createNfeGetDownloadUrlHandler,
  createNfeGetHandler,
  createNfeInutilizeHandler,
  createNfeIssueHandler,
  createNfeListHandler,
  createNfeNumberGapsHandler,
  createNfeReviewHandler,
  createNfeSettingsGetHandler,
  createNfeSettingsUpdateHandler,
  createNfeValidateHandler,
} from './nfe.tools';
import { toDetailedNfe, toPublicNfe } from './public-shapes';

const ID = '11111111-1111-4111-8111-111111111111';
const NEW_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const ctx = {
  authUserId: 'user-1',
  activeTenantId: 'tenant-1',
  tenantId: 'tenant-1',
  executionEnvironment: 'test',
  scope: 'nfse:read nfse:write',
} as unknown as AuthContext;

type Role = 'admin' | 'developer' | 'billing';

function build(
  options: {
    role?: Role;
    routes?: Record<string, unknown>;
  } = {},
) {
  const routes = {
    create: jest.fn().mockResolvedValue({
      data: { type: 'nfe', id: ID, status: 'queued' },
    }),
    validate: jest.fn().mockResolvedValue({
      data: { valid: true, issues: [], xml: '<NFe>segredo</NFe>' },
    }),
    get: jest.fn().mockResolvedValue({
      data: {
        id: ID,
        status: 'authorized',
        signedXml: '<NFe/>',
        accessKey: 'k',
      },
    }),
    events: jest.fn().mockResolvedValue({ data: [{ kind: 'status' }] }),
    list: jest.fn().mockResolvedValue({
      data: [
        {
          id: ID,
          companyId: COMPANY,
          status: 'authorized',
          series: 1,
          number: 7,
          accessKey: 'k',
          totals: { vNF: '10.00' },
          recipient: { name: 'Maria', taxId: '12345678909' },
          authorizedAt: null,
          createdAt: null,
          lastError: null,
        },
      ],
      pagination: { nextCursor: 'next' },
    }),
    cancel: jest
      .fn()
      .mockResolvedValue({ data: { id: ID, status: 'cancelling' } }),
    sync: jest
      .fn()
      .mockResolvedValue({ data: { id: ID, status: 'authorized' } }),
    discard: jest
      .fn()
      .mockResolvedValue({ data: { id: ID, status: 'discarded' } }),
    repeat: jest.fn().mockResolvedValue({
      data: { type: 'nfe', id: NEW_ID, status: 'queued' },
    }),
    email: jest
      .fn()
      .mockResolvedValue({ data: { emailId: 'eml_1', status: 'queued' } }),
    correct: jest
      .fn()
      .mockResolvedValue({ data: { id: 'e1', type: 'correction' } }),
    createInutilization: jest.fn().mockResolvedValue({ data: { id: 'i1' } }),
    numberGaps: jest.fn().mockResolvedValue({
      data: [{ companyId: COMPANY, series: 1, start: 3, end: 4 }],
    }),
    downloadUrl: jest.fn().mockResolvedValue({
      data: {
        downloadUrl: 'https://files/x',
        expiresAt: '2026-11-26T13:00:00.000Z',
        fileName: 'nfe.pdf',
        mimeType: 'application/pdf',
      },
    }),
    ...options.routes,
  };
  const router = {
    forType: jest.fn().mockImplementation(() => routes),
    owner: jest.fn().mockResolvedValue(routes),
    summaries: jest.fn().mockResolvedValue({
      data: [
        {
          type: 'nfe',
          id: ID,
          companyId: COMPANY,
          status: 'authorized',
          number: 1,
          accessKey: null,
          amount: '10.00',
          externalId: null,
          issuedAt: null,
          createdAt: new Date(0),
        },
      ],
      pagination: { nextCursor: null },
    }),
  };
  const memberships = {
    findByAuthUserAndTenant: jest
      .fn()
      .mockResolvedValue({ role: options.role ?? 'admin', isActive: true }),
  };
  const settings = {
    get: jest.fn().mockResolvedValue({ companyId: COMPANY, missing: [] }),
    update: jest.fn().mockResolvedValue({ companyId: COMPANY, missing: [] }),
  };
  const nfe = new McpNfe(
    router as never,
    memberships as never,
    settings as never,
  );
  return { nfe, routes, router, memberships, settings };
}

const nfeBody = { recipient: { taxId: '12345678909' }, items: [] };

describe('byType', () => {
  it('sem type o handler da NFS-e roda como antes', async () => {
    const nfse = jest.fn().mockResolvedValue('nfse');
    const nfeHandler = jest.fn();
    const handler = byType(nfse, { nfe: nfeHandler });
    expect(await handler({ amount: 1 }, ctx)).toBe('nfse');
    expect(await handler({ type: 'nfse' }, ctx)).toBe('nfse');
    expect(nfeHandler).not.toHaveBeenCalled();
  });

  it('type nfe vai para o handler da NF-e e um type inválido é recusado', async () => {
    const nfse = jest.fn();
    const nfeHandler = jest.fn().mockResolvedValue('nfe');
    const nfceHandler = jest.fn().mockResolvedValue('nfce');
    const handler = byType(nfse, { nfe: nfeHandler, nfce: nfceHandler });
    expect(await handler({ type: 'nfe' }, ctx)).toBe('nfe');
    expect(await handler({ type: 'nfce' }, ctx)).toBe('nfce');
    expect(nfse).not.toHaveBeenCalled();
    await expect(handler({ type: 'nfse-x' }, ctx)).rejects.toThrow(
      'type must be one of nfse, nfe, nfce',
    );
    await expect(handler({ type: 'all' }, ctx)).rejects.toThrow('type must be');
  });
});

describe('permissão', () => {
  it('papel sem nfe.documents.manage não cancela, corrige nem inutiliza', async () => {
    const { nfe, routes } = build({ role: 'billing' });
    await expect(
      createNfeCancelHandler(nfe)(
        { invoice_id: ID, description: 'cancelamento de teste ok' },
        ctx,
      ),
    ).rejects.toThrow('nfe.documents.manage');
    await expect(
      createNfeCorrectHandler(nfe)(
        { invoice_id: ID, correction: 'correção de teste ok' },
        ctx,
      ),
    ).rejects.toThrow('nfe.documents.manage');
    await expect(
      createNfeInutilizeHandler(nfe)(
        {
          company_id: COMPANY,
          series: 1,
          start: 1,
          end: 2,
          justification: 'justificativa longa o bastante',
        },
        ctx,
      ),
    ).rejects.toThrow('nfe.documents.manage');
    expect(routes.cancel).not.toHaveBeenCalled();
    expect(routes.correct).not.toHaveBeenCalled();
    expect(routes.createInutilization).not.toHaveBeenCalled();
    // reading is allowed to the same role
    await expect(
      createNfeGetHandler(nfe)({ invoice_id: ID }, ctx),
    ).resolves.toBeDefined();
  });

  it('o erro HTTP da API chega legível, com código e campos', async () => {
    const { nfe } = build({
      routes: {
        validate: jest.fn().mockRejectedValue(
          new UnprocessableEntityException({
            code: 'NFE_VALIDATION_FAILED',
            message: 'Request validation failed',
            details: [{ field: 'items[0].ncm', message: 'NCM inválido' }],
          }),
        ),
      },
    });
    await expect(
      createNfeValidateHandler(nfe)({ company_id: COMPANY, nfe: nfeBody }, ctx),
    ).rejects.toThrow(
      'NFE_VALIDATION_FAILED: Request validation failed | items[0].ncm: NCM inválido',
    );
  });
});

describe('type nfe nas ferramentas compartilhadas', () => {
  it('nfse_issue: exige idempotency_key e company_id, monta o corpo da API e devolve o id', async () => {
    const { nfe, routes } = build();
    const issue = createNfeIssueHandler(nfe);
    await expect(
      issue({ type: 'nfe', company_id: COMPANY, nfe: nfeBody }, ctx),
    ).rejects.toThrow('idempotency_key');
    await expect(
      issue({ type: 'nfe', nfe: nfeBody, idempotency_key: 'k1' }, ctx),
    ).rejects.toThrow('company_id');

    const out = await issue(
      {
        type: 'nfe',
        company_id: COMPANY,
        nfe: nfeBody,
        idempotency_key: 'k1',
        external_id: 'pedido-9',
        send_email: false,
      },
      ctx,
    );
    expect(out).toEqual({ type: 'nfe', invoice_id: ID, status: 'queued' });
    expect(routes.create).toHaveBeenCalledWith(
      {
        ...nfeBody,
        companyId: COMPANY,
        externalId: 'pedido-9',
        sendEmail: false,
      },
      'k1',
      expect.objectContaining({ tenantId: 'tenant-1', environment: 'test' }),
      expect.anything(),
    );
  });

  it('nfse_get: devolve a NF-e só com os campos permitidos (sem XML) e a linha do tempo', async () => {
    const { nfe } = build();
    const out = (await createNfeGetHandler(nfe)({ invoice_id: ID }, ctx)) as {
      invoice: Record<string, unknown>;
      events: unknown[];
    };
    expect(out.invoice).toEqual({
      id: ID,
      status: 'authorized',
      accessKey: 'k',
    });
    expect(JSON.stringify(out)).not.toContain('signedXml');
    expect(out.events).toEqual([{ kind: 'status' }]);
  });

  it('nfse_list type nfe: lista compacta com CPF mascarado e cursor', async () => {
    const { nfe, routes } = build();
    const out = (await createNfeListHandler(nfe)(
      { type: 'nfe', status: 'authorized', company_id: COMPANY, limit: 10 },
      ctx,
    )) as { invoices: Record<string, unknown>[]; next_cursor: string };
    expect(routes.list).toHaveBeenCalledWith(
      {
        limit: 10,
        cursor: undefined,
        companyId: COMPANY,
        status: 'authorized',
      },
      expect.anything(),
    );
    expect(out.next_cursor).toBe('next');
    expect(out.invoices[0]).toMatchObject({
      type: 'nfe',
      id: ID,
      amount: '10.00',
      recipientName: 'Maria',
      recipientTaxId: '***8909',
    });
    expect(JSON.stringify(out)).not.toContain('12345678909');
  });

  it('nfse_list type all: mistura os tipos; sem permissão de ler NF-e cai na lista de NFS-e', async () => {
    const nfseList = jest
      .fn()
      .mockResolvedValue({ invoices: [], next_cursor: null });
    const on = build();
    const all = createAllListHandler(on.nfe, nfseList);
    const out = (await all({ type: 'all' }, ctx)) as {
      invoices: { type: string }[];
    };
    expect(out.invoices[0].type).toBe('nfe');
    expect(nfseList).not.toHaveBeenCalled();

    const off = build();
    off.memberships.findByAuthUserAndTenant.mockResolvedValue({
      role: 'admin',
      isActive: false,
    });
    await createAllListHandler(off.nfe, nfseList)(
      { type: 'all', limit: 5 },
      ctx,
    );
    expect(nfseList).toHaveBeenCalledWith({ type: undefined, limit: 5 }, ctx);
  });

  it('nfse_cancel: usa description como justificativa', async () => {
    const { nfe, routes } = build();
    const out = await createNfeCancelHandler(nfe)(
      {
        type: 'nfe',
        invoice_id: ID,
        description: 'cliente desistiu da compra',
      },
      ctx,
    );
    expect(out).toEqual({ type: 'nfe', invoice_id: ID, status: 'cancelling' });
    expect(routes.cancel).toHaveBeenCalledWith(
      ID,
      { justification: 'cliente desistiu da compra' },
      expect.anything(),
    );
  });

  it('downloads: dão o link do tipo pedido e recusam o PDF inline', async () => {
    const { nfe, routes } = build();
    const url = (await createNfeGetDownloadUrlHandler(nfe)(
      { type: 'nfe', invoice_id: ID, format: 'xml' },
      ctx,
    )) as Record<string, string>;
    expect(url.download_url).toBe('https://files/x');
    expect(routes.downloadUrl).toHaveBeenCalledWith(
      ID,
      'xml',
      expect.anything(),
      expect.anything(),
    );
    await createNfeDownloadPdfHandler(nfe)(
      { type: 'nfe', invoice_id: ID },
      ctx,
    );
    expect(routes.downloadUrl).toHaveBeenLastCalledWith(
      ID,
      'pdf',
      expect.anything(),
      expect.anything(),
    );
    await expect(
      createNfeDownloadPdfHandler(nfe)(
        { type: 'nfe', invoice_id: ID, inline: true },
        ctx,
      ),
    ).rejects.toThrow('inline is not available');
  });

  it('nfse_review: retry consulta (sync) e discard descarta', async () => {
    const { nfe, routes } = build();
    const review = createNfeReviewHandler(nfe);
    await review({ type: 'nfe', invoice_id: ID, action: 'retry' }, ctx);
    expect(routes.sync).toHaveBeenCalledWith(ID, expect.anything());
    await review({ type: 'nfe', invoice_id: ID, action: 'discard' }, ctx);
    expect(routes.discard).toHaveBeenCalledWith(ID, expect.anything());
  });
});

describe('ferramentas só de NF-e', () => {
  it('nfe_validate nunca devolve o XML', async () => {
    const { nfe, routes } = build();
    const out = await createNfeValidateHandler(nfe)(
      { company_id: COMPANY, nfe: nfeBody },
      ctx,
    );
    expect(out).toEqual({ valid: true, issues: [] });
    expect(routes.validate).toHaveBeenCalledWith(
      { ...nfeBody, companyId: COMPANY },
      false,
      expect.anything(),
    );
  });

  it('nfe_correct, nfe_inutilize e nfe_number_gaps chamam as rotas', async () => {
    const { nfe, routes } = build();
    await createNfeCorrectHandler(nfe)(
      { invoice_id: ID, correction: 'corrigir o endereço de entrega' },
      ctx,
    );
    expect(routes.correct).toHaveBeenCalledWith(
      ID,
      { correction: 'corrigir o endereço de entrega' },
      expect.anything(),
    );
    await createNfeInutilizeHandler(nfe)(
      {
        company_id: COMPANY,
        series: 1,
        start: 3,
        end: 4,
        justification: 'numeração pulada por falha',
        idempotency_key: 'k',
      },
      ctx,
    );
    expect(routes.createInutilization).toHaveBeenCalledWith(
      {
        companyId: COMPANY,
        series: 1,
        start: 3,
        end: 4,
        justification: 'numeração pulada por falha',
      },
      'k',
      expect.anything(),
      expect.anything(),
    );
    expect(
      await createNfeNumberGapsHandler(nfe)({ company_id: COMPANY }, ctx),
    ).toEqual({ gaps: [{ companyId: COMPANY, series: 1, start: 3, end: 4 }] });
  });

  it('nfe_settings_get e nfe_settings_update usam o serviço da empresa', async () => {
    const { nfe, settings } = build();
    await createNfeSettingsGetHandler(nfe)({ company_id: COMPANY }, ctx);
    expect(settings.get).toHaveBeenCalledWith(COMPANY, 'tenant-1', 'test');
    await createNfeSettingsUpdateHandler(nfe)(
      {
        company_id: COMPANY,
        state_registration: '110042490114',
        crt: 1,
        default_series: 2,
      },
      ctx,
    );
    expect(settings.update).toHaveBeenCalledWith(
      COMPANY,
      'tenant-1',
      'test',
      expect.objectContaining({
        stateRegistration: '110042490114',
        crt: 1,
        defaultSeries: 2,
      }),
    );
    await expect(
      createNfeSettingsUpdateHandler(nfe)(
        { company_id: COMPANY, state_registration: '110042490114', crt: 3 },
        ctx,
      ),
    ).rejects.toThrow('crt');
  });

  it('atualizar as configurações exige nfe.documents.manage; ler, só nfe.documents.view', async () => {
    const { nfe, settings } = build({ role: 'billing' });
    await expect(
      createNfeSettingsUpdateHandler(nfe)(
        { company_id: COMPANY, state_registration: '110042490114', crt: 1 },
        ctx,
      ),
    ).rejects.toThrow('nfe.documents.manage');
    expect(settings.update).not.toHaveBeenCalled();
    await createNfeSettingsGetHandler(nfe)({ company_id: COMPANY }, ctx);
    expect(settings.get).toHaveBeenCalled();
  });
});

describe('tools/list', () => {
  it('as seis ferramentas só de NF-e aparecem para todas as contas, sem liberação', async () => {
    const server = new McpServer();
    for (const tool of [
      NFE_VALIDATE_TOOL,
      NFE_CORRECT_TOOL,
      NFE_INUTILIZE_TOOL,
      NFE_NUMBER_GAPS_TOOL,
      NFE_SETTINGS_GET_TOOL,
      NFE_SETTINGS_UPDATE_TOOL,
    ])
      server.registerTool(tool, async () => ({}));
    const names = (await server.getToolDefinitions(ctx)).map((t) => t.name);
    expect([...names].sort()).toEqual(
      [
        'nfe_correct',
        'nfe_inutilize',
        'nfe_number_gaps',
        'nfe_settings_get',
        'nfe_settings_update',
        'nfe_validate',
      ].sort(),
    );
  });
});

describe('type nfce', () => {
  it('nfse_issue com nfce: usa as rotas da NFC-e, monta o corpo e devolve type nfce', async () => {
    const { nfe, routes, router } = build();
    const out = await createNfeIssueHandler(nfe, 'nfce')(
      {
        type: 'nfce',
        company_id: COMPANY,
        nfe: { items: [], payments: [] },
        idempotency_key: 'k1',
      },
      ctx,
    );
    expect(router.forType).toHaveBeenCalledWith(
      'nfce',
      expect.anything(),
      'nfe.documents.issue',
    );
    expect(routes.create).toHaveBeenCalledWith(
      { items: [], payments: [], companyId: COMPANY },
      'k1',
      expect.anything(),
      expect.anything(),
    );
    expect(out).toEqual({ type: 'nfce', invoice_id: ID, status: 'queued' });
  });

  it('get, list, cancel, review e downloads usam o tipo nfce', async () => {
    const { nfe, router } = build();
    await createNfeGetHandler(nfe, 'nfce')({ invoice_id: ID }, ctx);
    const list = await createNfeListHandler(nfe, 'nfce')({}, ctx);
    expect((list as { invoices: { type: string }[] }).invoices[0].type).toBe(
      'nfe',
    );
    expect(
      await createNfeCancelHandler(nfe, 'nfce')(
        { invoice_id: ID, description: 'cancelamento dentro de 30 minutos' },
        ctx,
      ),
    ).toEqual({ type: 'nfce', invoice_id: ID, status: 'cancelling' });
    expect(
      await createNfeReviewHandler(nfe, 'nfce')(
        { invoice_id: ID, action: 'retry' },
        ctx,
      ),
    ).toMatchObject({ type: 'nfce', action: 'retry' });
    expect(
      await createNfeGetDownloadUrlHandler(nfe, 'nfce')(
        { invoice_id: ID, format: 'pdf' },
        ctx,
      ),
    ).toMatchObject({ type: 'nfce', format: 'pdf' });
    await expect(
      createNfeDownloadPdfHandler(nfe, 'nfce')(
        { invoice_id: ID, inline: true },
        ctx,
      ),
    ).rejects.toThrow('inline is not available for NFC-e');
    const types = router.forType.mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(types)).toEqual(new Set(['nfce']));
  });

  it('nfe_validate com type nfce valida na rota da NFC-e (sem XML)', async () => {
    const { nfe, routes, router } = build();
    const out = await createNfeValidateHandler(nfe)(
      { company_id: COMPANY, type: 'nfce', nfe: nfeBody },
      ctx,
    );
    expect(out).toEqual({ valid: true, issues: [] });
    expect(router.forType).toHaveBeenCalledWith(
      'nfce',
      expect.anything(),
      'nfe.documents.issue',
    );
    expect(routes.validate).toHaveBeenCalled();
    await expect(
      createNfeValidateHandler(nfe)(
        { company_id: COMPANY, type: 'nfse', nfe: nfeBody },
        ctx,
      ),
    ).rejects.toThrow('type');
  });

  it('nfe_correct numa NFC-e devolve INVOICE_OPERATION_NOT_SUPPORTED', async () => {
    const { nfe } = build({
      routes: {
        correct: jest.fn().mockRejectedValue(
          new UnprocessableEntityException({
            code: 'INVOICE_OPERATION_NOT_SUPPORTED',
            message: 'A NFC-e has no correction letter',
          }),
        ),
      },
    });
    await expect(
      createNfeCorrectHandler(nfe)(
        { invoice_id: ID, correction: 'corrigir o endereço de entrega' },
        ctx,
      ),
    ).rejects.toThrow('INVOICE_OPERATION_NOT_SUPPORTED');
  });

  it('nfe_correct com id que ninguém tem: não encontrada', async () => {
    const { nfe, router } = build();
    router.owner.mockResolvedValue(null);
    await expect(
      createNfeCorrectHandler(nfe)(
        { invoice_id: ID, correction: 'corrigir o endereço de entrega' },
        ctx,
      ),
    ).rejects.toThrow('RESOURCE_NOT_FOUND');
  });

  it('nfe_inutilize e nfe_number_gaps aceitam model 65 (padrão 55)', async () => {
    const { nfe, router } = build();
    await createNfeNumberGapsHandler(nfe)(
      { company_id: COMPANY, model: 65 },
      ctx,
    );
    await createNfeInutilizeHandler(nfe)(
      {
        company_id: COMPANY,
        model: 65,
        series: 1,
        start: 3,
        end: 4,
        justification: 'numeração pulada por falha',
      },
      ctx,
    );
    expect(router.forType.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'nfce',
      'nfce',
    ]);
    router.forType.mockClear();
    await createNfeNumberGapsHandler(nfe)({}, ctx);
    expect(router.forType).toHaveBeenCalledWith(
      'nfe',
      expect.anything(),
      'nfe.documents.view',
    );
    await expect(
      createNfeNumberGapsHandler(nfe)({ model: 57 }, ctx),
    ).rejects.toThrow('model');
  });

  it('nfe_settings_update grava a série da NFC-e', async () => {
    const { nfe, settings } = build();
    await createNfeSettingsUpdateHandler(nfe)(
      {
        company_id: COMPANY,
        state_registration: '110042490114',
        nfce_default_series: 3,
      },
      ctx,
    );
    expect(settings.update).toHaveBeenCalledWith(
      COMPANY,
      'tenant-1',
      'test',
      expect.objectContaining({ nfceDefaultSeries: 3 }),
    );
  });

  it('toDetailedNfe leva o QR e o link da consulta; toPublicNfe mantém type nfce', () => {
    expect(
      toDetailedNfe({
        id: ID,
        type: 'nfce',
        qrCode: 'https://q?p=1',
        urlChave: 'https://consulta',
        signedXml: '<NFe/>',
      }),
    ).toEqual({
      id: ID,
      type: 'nfce',
      qrCode: 'https://q?p=1',
      urlChave: 'https://consulta',
    });
    expect(
      toPublicNfe({
        type: 'nfce',
        id: ID,
        companyId: COMPANY,
        status: 'authorized',
        series: 1,
        number: 1,
        accessKey: null,
        recipient: null,
        authorizedAt: null,
        createdAt: null,
      }).type,
    ).toBe('nfce');
  });
});

describe('formas públicas da NF-e', () => {
  it('toDetailedNfe descarta o que não está na lista (XML, segredos)', () => {
    const out = toDetailedNfe({
      id: ID,
      status: 'authorized',
      signedXml: '<NFe/>',
      protNfeXml: '<prot/>',
      certificatePassword: 'x',
    });
    expect(out).toEqual({ id: ID, status: 'authorized' });
  });

  it('toPublicNfe mascara o documento do destinatário', () => {
    const out = toPublicNfe({
      id: ID,
      companyId: COMPANY,
      status: 'authorized',
      series: 1,
      number: 1,
      accessKey: null,
      totals: { vNF: '5.00' },
      recipient: { name: 'Ana', taxId: '11222333000181' },
      authorizedAt: null,
      createdAt: null,
      lastError: { code: 'X', message: 'm' },
    });
    expect(out.recipientTaxId).toBe('***0181');
    expect(out.errorCode).toBe('X');
  });
});

describe('nfe_repeat e reenvio de e-mail', () => {
  it('nfe_repeat copia pela rota do tipo, com a chave e o texto novo, e devolve o id da cópia', async () => {
    const { nfe, routes, router } = build();
    const out = await createNfeRepeatHandler(nfe)(
      {
        invoice_id: ID,
        idempotency_key: 'k-1',
        additional_info: 'Pedido 77',
      },
      ctx,
    );
    expect(out).toEqual({
      type: 'nfe',
      invoice_id: NEW_ID,
      status: 'queued',
      copied_from_invoice_id: ID,
    });
    expect(router.forType).toHaveBeenCalledWith(
      'nfe',
      expect.anything(),
      'nfe.documents.issue',
    );
    expect(routes.repeat).toHaveBeenCalledWith(
      ID,
      { additionalInfo: 'Pedido 77' },
      'k-1',
      expect.anything(),
      expect.anything(),
    );
  });

  it('nfe_repeat com type nfce usa as rotas da NFC-e; sem chave é recusado', async () => {
    const { nfe, router, routes } = build();
    await createNfeRepeatHandler(nfe)(
      { invoice_id: ID, type: 'nfce', idempotency_key: 'k-2' },
      ctx,
    );
    expect(router.forType).toHaveBeenCalledWith(
      'nfce',
      expect.anything(),
      'nfe.documents.issue',
    );
    expect(routes.repeat).toHaveBeenCalledWith(
      ID,
      {},
      'k-2',
      expect.anything(),
      expect.anything(),
    );
    await expect(
      createNfeRepeatHandler(nfe)({ invoice_id: ID }, ctx),
    ).rejects.toThrow(/idempotency_key/);
  });

  it('nfe_repeat repassa a recusa de uma nota que não é venda normal', async () => {
    const { nfe } = build({
      routes: {
        repeat: jest.fn().mockRejectedValue(
          new UnprocessableEntityException({
            code: 'NFE_REPEAT_NOT_NORMAL',
            message: 'Only a normal NF-e (finNfe 1) can be copied',
          }),
        ),
      },
    });
    await expect(
      createNfeRepeatHandler(nfe)(
        { invoice_id: ID, idempotency_key: 'k-3' },
        ctx,
      ),
    ).rejects.toThrow(/NFE_REPEAT_NOT_NORMAL/);
  });

  it('papel sem nfe.documents.issue não copia nem reenvia', async () => {
    const { nfe, routes } = build({ role: 'billing' });
    await expect(
      createNfeRepeatHandler(nfe)(
        { invoice_id: ID, idempotency_key: 'k-4' },
        ctx,
      ),
    ).rejects.toThrow();
    await expect(
      createNfeEmailResendHandler(nfe)({ invoice_id: ID }, ctx),
    ).rejects.toThrow();
    expect(routes.repeat).not.toHaveBeenCalled();
    expect(routes.email).not.toHaveBeenCalled();
  });

  it('nfse_email_resend com nfe e nfce: usa as rotas do tipo e o endereço opcional', async () => {
    const { nfe, routes, router } = build();
    const nfeOut = await createNfeEmailResendHandler(nfe)(
      { type: 'nfe', invoice_id: ID, email: ' a@b.com ' },
      ctx,
    );
    expect(nfeOut).toEqual({
      type: 'nfe',
      invoice_id: ID,
      email_id: 'eml_1',
      status: 'queued',
    });
    expect(routes.email).toHaveBeenCalledWith(
      ID,
      'a@b.com',
      undefined,
      expect.anything(),
    );
    await createNfeEmailResendHandler(nfe, 'nfce')({ invoice_id: ID }, ctx);
    expect(router.forType).toHaveBeenLastCalledWith(
      'nfce',
      expect.anything(),
      'nfe.documents.issue',
    );
    await expect(
      createNfeEmailResendHandler(nfe)(
        { invoice_id: ID, email: 'não é e-mail' },
        ctx,
      ),
    ).rejects.toThrow();
  });
});
