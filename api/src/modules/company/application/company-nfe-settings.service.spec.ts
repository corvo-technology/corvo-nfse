import { UnprocessableEntityException } from '@nestjs/common';
import { Company } from '../domain/company';
import type { ICompanyNfeSettingsRepository } from '../domain/company-nfe-settings.repository';
import type { ICadastroLookup } from '../domain/cadastro-lookup';
import type { RegistrationLookup } from '../domain/nfe-registration';
import type { NfeSettings } from '../domain/nfe-settings';
import { CompanyNfeSettingsService } from './company-nfe-settings.service';
import type { CompanyService } from './company.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

const company = (state?: string) =>
  Company.create(
    {
      legalName: 'Empresa Teste LTDA',
      taxId: '11222333000181',
      taxRegime: 'Simples Nacional',
      municipalityCode: '3550308',
      address: {
        street: 'Rua A',
        number: '10',
        district: 'Centro',
        state,
        zip: '01310100',
      },
    },
    tenantId,
  );

function build(
  c: Company,
  regime: string | null = 'Simples Nacional',
  stored: NfeSettings | null = null,
  lookup: RegistrationLookup = { kind: 'unavailable' },
) {
  const saved: NfeSettings = {
    companyId: c.id,
    tenantId,
    stateRegistration: '110042490114',
    crt: 1,
    defaultSeries: 1,
    nfceDefaultSeries: 1,
    nfceAutoOffline: false,
    defaultNatOp: 'Venda de mercadoria',
    defaultCsosn: '102',
    defaultOrigin: 0,
    defaultPisCst: '49',
    defaultCofinsCst: '49',
    enabledAt: null,
  };
  const repo = {
    find: jest.fn().mockResolvedValue(stored),
    upsert: jest.fn().mockResolvedValue(saved),
    saveRegistrationCheck: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ICompanyNfeSettingsRepository>;
  const companies = {
    findById: jest.fn().mockResolvedValue(c),
    currentRegime: jest.fn().mockResolvedValue({
      taxRegime: regime,
      simpleNational: regime !== null,
      specialRegime: null,
    }),
  } as unknown as CompanyService;
  const cadastro = {
    lookup: jest.fn().mockResolvedValue(lookup),
  } as unknown as jest.Mocked<ICadastroLookup>;
  return {
    service: new CompanyNfeSettingsService(companies, repo, cadastro),
    repo,
    cadastro,
  };
}

const settingsRow = (companyId: string): NfeSettings => ({
  companyId,
  tenantId,
  stateRegistration: '110042490114',
  crt: null,
  defaultSeries: 1,
  nfceDefaultSeries: 1,
  nfceAutoOffline: false,
  defaultNatOp: 'Venda de mercadoria',
  defaultCsosn: '102',
  defaultOrigin: 0,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
  enabledAt: null,
});

describe('CompanyNfeSettingsService', () => {
  it('shows the defaults and what is missing before any setting', async () => {
    const { service } = build(company('SP'));
    const view = await service.get('c', tenantId, 'test');
    expect(view).toMatchObject({
      stateRegistration: null,
      crt: null,
      taxRegime: 'Simples Nacional',
      defaultSeries: 1,
      nfceDefaultSeries: 1,
      nfceAutoOffline: false,
      defaultCsosn: '102',
      missing: ['state_registration'],
    });
  });

  it('shows the CRT that follows the tax regime and does not list it as missing', async () => {
    const c = company('SP');
    const row = { ...settingsRow(c.id), crt: 1 as const };
    const { service } = build(c, 'Simples Nacional', row);
    const view = await service.get('c', tenantId, 'test');
    expect(view).toMatchObject({ crt: 1, taxRegime: 'Simples Nacional' });
    expect(view.missing).not.toContain('crt');
  });

  it('lists the CRT as missing only for a regime NF-e does not cover', async () => {
    const c = company('SP');
    const row = { ...settingsRow(c.id), crt: null };
    const { service } = build(c, 'Lucro Presumido', row);
    const view = await service.get('c', tenantId, 'test');
    expect(view).toMatchObject({ crt: null, taxRegime: 'Lucro Presumido' });
    expect(view.missing).toEqual(['crt']);
  });

  it('saves the NFC-e series apart from the NF-e one', async () => {
    const { service, repo } = build(company('SP'));
    await service.update('c', tenantId, 'test', {
      stateRegistration: '110042490114',
      defaultSeries: 2,
      nfceDefaultSeries: 9,
    });
    expect(repo.upsert).toHaveBeenCalledWith(
      'c',
      tenantId,
      expect.objectContaining({ defaultSeries: 2, nfceDefaultSeries: 9 }),
    );
  });

  it('keeps the off-line NFC-e option off unless asked, and saves it when it is', async () => {
    const { service, repo } = build(company('SP'));
    await service.update('c', tenantId, 'test', {
      stateRegistration: '110042490114',
    });
    expect(repo.upsert).toHaveBeenLastCalledWith(
      'c',
      tenantId,
      expect.objectContaining({ nfceAutoOffline: false }),
    );
    await service.update('c', tenantId, 'test', {
      stateRegistration: '110042490114',
      nfceAutoOffline: true,
    });
    expect(repo.upsert).toHaveBeenLastCalledWith(
      'c',
      tenantId,
      expect.objectContaining({ nfceAutoOffline: true }),
    );
  });

  it('saves a valid IE with the defaults filled in, digits only', async () => {
    const { service, repo } = build(company('SP'));
    const view = await service.update('c', tenantId, 'test', {
      stateRegistration: '110.042.490.114',
    });
    expect(repo.upsert).toHaveBeenCalledWith(
      'c',
      tenantId,
      expect.objectContaining({
        stateRegistration: '110042490114',
        crt: null,
        defaultNatOp: 'Venda de mercadoria',
        defaultPisCst: '49',
      }),
    );
    expect(view.missing).toEqual([]);
  });

  it('refuses an invalid IE with STATE_REGISTRATION_INVALID', async () => {
    const { service, repo } = build(company('SP'));
    const attempt = service.update('c', tenantId, 'test', {
      stateRegistration: '110042490115',
      crt: 1,
    });
    await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: 'STATE_REGISTRATION_INVALID' },
    });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('refuses an IE when the company has no state yet', async () => {
    const { service } = build(company());
    await expect(
      service.update('c', tenantId, 'test', {
        stateRegistration: '110042490114',
        crt: 1,
      }),
    ).rejects.toMatchObject({
      response: { code: 'STATE_REGISTRATION_INVALID' },
    });
  });

  describe('Consulta Cadastro da SEFAZ', () => {
    const found = (
      ...registrations: {
        stateRegistration: string;
        enabled: boolean;
        nfeCredential?: 'yes' | 'no' | 'unknown';
      }[]
    ): RegistrationLookup => ({
      kind: 'found',
      registrations: registrations.map((r) => ({
        nfeCredential: 'unknown' as const,
        ...r,
      })),
    });

    it('sem IE salva e com uma só habilitada: sugere a IE', async () => {
      const { service } = build(
        company('SP'),
        'Simples Nacional',
        null,
        found({ stateRegistration: '110042490114', enabled: true }),
      );
      const view = (await service.get('c', tenantId, 'test', { check: true }))
        .readiness!;
      expect(view).toMatchObject({
        ready: false,
        status: 'ie_suggested',
        suggestedStateRegistration: '110042490114',
      });
    });

    it('empresa sem IE (só serviço) não pode emitir', async () => {
      const { service } = build(company('SP'), 'Simples Nacional', null, {
        kind: 'not_found',
      });
      const view = (await service.get('c', tenantId, 'test', { check: true }))
        .readiness!;
      expect(view.status).toBe('no_registration');
      expect(view.message).toContain('Empresa sem inscrição estadual');
    });

    it('IE habilitada e cadastro completo: pronta, e guarda a resposta', async () => {
      const c = company('SP');
      const { service, repo } = build(
        c,
        'Simples Nacional',
        { ...settingsRow(c.id), crt: 1 as const },
        found({ stateRegistration: '110042490114', enabled: true }),
      );
      const view = (await service.get('c', tenantId, 'test', { check: true }))
        .readiness!;
      expect(view).toMatchObject({ ready: true, status: 'ready' });
      expect(repo.saveRegistrationCheck).toHaveBeenCalledWith(
        c.id,
        tenantId,
        expect.objectContaining({
          status: 'ready',
          stateRegistration: '110042490114',
        }),
      );
    });

    it('consulta indisponível: neutra, não guarda nada e não impede a nota', async () => {
      const c = company('SP');
      const { service, repo } = build(c, 'Simples Nacional', {
        ...settingsRow(c.id),
        crt: 1 as const,
      });
      const view = (await service.get('c', tenantId, 'test', { check: true }))
        .readiness!;
      expect(view.status).toBe('unavailable');
      expect(view.message).toContain('sintegra.gov.br');
      expect(repo.saveRegistrationCheck).not.toHaveBeenCalled();
    });

    it('sem certificado: explica', async () => {
      const c = company('SP');
      const { service } = build(
        c,
        'Simples Nacional',
        { ...settingsRow(c.id), crt: 1 as const },
        {
          kind: 'no_certificate',
        },
      );
      const view = (await service.get('c', tenantId, 'test', { check: true }))
        .readiness!;
      expect(view.status).toBe('no_certificate');
      expect(view.message).toContain('certificado');
    });

    it('cadastro da empresa incompleto aparece antes de "pronta"', async () => {
      const c = company('SP');
      const row = { ...settingsRow(c.id), crt: null };
      const { service } = build(
        c,
        'Lucro Presumido',
        row,
        found({ stateRegistration: '110042490114', enabled: true }),
      );
      const view = (await service.get('c', tenantId, 'test', { check: true }))
        .readiness!;
      expect(view).toMatchObject({
        ready: false,
        status: 'company_incomplete',
      });
    });

    it('sem check=sefaz não consulta a SEFAZ: readiness é a última resposta guardada (ou null)', async () => {
      const c = company('SP');
      const { service } = build(
        c,
        'Simples Nacional',
        { ...settingsRow(c.id), crt: 1 as const },
        found({ stateRegistration: '110042490114', enabled: true }),
      );
      expect((await service.get('c', tenantId, 'test')).readiness).toBeNull();
      const kept = build(
        c,
        'Simples Nacional',
        {
          ...settingsRow(c.id),
          crt: 1 as const,
          registrationCheck: {
            status: 'not_enabled',
            checkedAt: new Date(),
            stateRegistration: settingsRow(c.id).stateRegistration ?? '',
          },
        },
        found({ stateRegistration: '110042490114', enabled: true }),
      );
      const view = await kept.service.get('c', tenantId, 'test');
      expect(view.readiness).toMatchObject({
        ready: false,
        status: 'not_enabled',
      });
    });

    it('salvar sem IE usa a que a SEFAZ achou', async () => {
      const { service, repo } = build(
        company('SP'),
        'Simples Nacional',
        null,
        found({ stateRegistration: '110042490114', enabled: true }),
      );
      await service.update('c', tenantId, 'test', {});
      expect(repo.upsert).toHaveBeenCalledWith(
        'c',
        tenantId,
        expect.objectContaining({ stateRegistration: '110042490114' }),
      );
    });

    it('salvar sem IE e sem nenhuma na SEFAZ: 422 com a explicação', async () => {
      const { service, repo } = build(company('SP'), 'Simples Nacional', null, {
        kind: 'not_found',
      });
      await expect(
        service.update('c', tenantId, 'test', {}),
      ).rejects.toMatchObject({
        response: {
          code: 'STATE_REGISTRATION_REQUIRED',
          message: expect.stringContaining('sem inscrição estadual'),
        },
      });
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('IE digitada que a SEFAZ não conhece: salva e avisa', async () => {
      const { service, repo } = build(
        company('SP'),
        'Simples Nacional',
        null,
        found({ stateRegistration: '110042490114', enabled: true }),
      );
      const view = await service.update('c', tenantId, 'test', {
        stateRegistration: '123456785004',
      });
      expect(repo.upsert).toHaveBeenCalled();
      expect(view.registrationWarning).toContain('não é deste CNPJ');
      expect(repo.saveRegistrationCheck).toHaveBeenCalledWith(
        'c',
        tenantId,
        expect.objectContaining({ status: 'ie_mismatch' }),
      );
    });

    it('consulta fora do ar ao salvar: salva sem aviso', async () => {
      const { service } = build(company('SP'));
      const view = await service.update('c', tenantId, 'test', {
        stateRegistration: '110042490114',
      });
      expect(view.registrationWarning).toBeNull();
    });
  });
});
