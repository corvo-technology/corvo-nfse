import { UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { Company } from '@/modules/company/domain/company';
import type { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import type {
  NfeEmissionPreconditions,
  NfePreconditionError,
} from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import type { SchemaValidator } from '@/modules/fiscal-core/domain/ports/xml.port';
import { XmllintSchemaValidator } from '@/infra/external/nfe/sefaz/schema-validator';
import { inputFixture } from '../testing/draft-fixture';
import { NfePreparation } from './nfe-preparation.service';
import { NfeValidateService } from './nfe-validate.service';

const TENANT = '00000000-0000-4000-8000-0000000000aa';

const company = (overrides: Record<string, unknown> = {}): Company =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    taxId: '11222333000181',
    legalName: 'Empresa Teste LTDA',
    tradeName: 'Empresa Teste',
    municipalityCode: '3550308',
    addressStreet: 'Avenida Paulista',
    addressNumber: '1000',
    addressDistrict: 'Bela Vista',
    addressZip: '01310-100',
    addressCity: 'São Paulo',
    addressState: 'SP',
    ...overrides,
  }) as unknown as Company;

const settings: NfeSettings = {
  companyId: '00000000-0000-4000-8000-000000000001',
  tenantId: TENANT,
  stateRegistration: '110042490114',
  crt: 1,
  defaultSeries: 1,
  defaultNatOp: 'Venda de mercadoria',
  defaultCsosn: '102',
  defaultOrigin: 0,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
  enabledAt: null,
};

function setup(
  options: {
    company?: Company;
    blocked?: NfePreconditionError | null;
    schema?: SchemaValidator;
    config?: Record<string, string>;
  } = {},
) {
  const peek = jest.fn().mockResolvedValue({ series: 1, number: 42 });
  const check = jest.fn().mockResolvedValue(options.blocked ?? null);
  const service = new NfeValidateService(
    new NfePreparation(
      {
        findById: jest.fn().mockResolvedValue(options.company ?? company()),
      } as unknown as CompanyService,
      {
        find: jest.fn().mockResolvedValue(settings),
      } as unknown as ICompanyNfeSettingsRepository,
      { check } as unknown as NfeEmissionPreconditions,
    ),
    { peekNext: peek },
    options.schema ?? new XmllintSchemaValidator(),
    { get: (key: string) => options.config?.[key] } as unknown as ConfigService,
  );
  return { service, peek, check };
}

const run = (
  service: NfeValidateService,
  includeXml = false,
  input = inputFixture(),
) => service.validate(TENANT, 'test', input, includeXml);

async function failure(
  promise: Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UnprocessableEntityException)
      return error.getResponse() as Record<string, unknown>;
    throw error;
  }
  throw new Error('expected a 422');
}

describe('NfeValidateService', () => {
  it('answers valid with the preview key built from the previewed number', async () => {
    const { service, peek } = setup();
    const result = await run(service);
    expect(result.valid).toBe(true);
    expect(result.accessKeyPreview).toMatch(
      /^35\d{4}11222333000181550010000000421\d{9}$/,
    );
    expect(result.xml).toBeUndefined();
    expect(peek).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, model: 55, series: 1 }),
    );
  });

  it('returns the XML only when asked, with the placeholder signature left out', async () => {
    const { service } = setup();
    const result = await run(service, true);
    expect(result.xml).toContain('<nNF>42</nNF>');
    expect(result.xml).not.toContain('<Signature');
    expect(result.xml).not.toContain('<infRespTec>');
  });

  it('writes infRespTec when the four NFE_RESP_TEC settings exist', async () => {
    const { service } = setup({
      config: {
        NFE_RESP_TEC_CNPJ: '11222333000181',
        NFE_RESP_TEC_CONTACT: 'Corvo',
        NFE_RESP_TEC_EMAIL: 'suporte@corvo.tech',
        NFE_RESP_TEC_PHONE: '1133334444',
        APP_VERSION: '1.2.3',
      },
    });
    const result = await run(service, true);
    expect(result.xml).toContain('<xContato>Corvo</xContato>');
    expect(result.xml).toContain('<verProc>Corvo 1.2.3</verProc>');
  });

  it('turns a failed precondition into a configuration error, before numbering', async () => {
    const blocked: NfePreconditionError = {
      code: 'UF_NOT_ENABLED',
      message: 'UF ainda não liberada',
      step: 'nfe_preconditions',
      details: { uf: 'SP' },
      retryable: false,
      category: 'CONFIGURATION',
    };
    const { service, peek } = setup({ blocked });
    const body = await failure(run(service));
    expect(body).toMatchObject({
      code: 'UF_NOT_ENABLED',
      type: 'configuration',
      details: { uf: 'SP' },
    });
    expect(peek).not.toHaveBeenCalled();
  });

  it('lists what the company lacks as fields', async () => {
    const blocked: NfePreconditionError = {
      code: 'COMPANY_NFE_INCOMPLETE',
      message: 'Complete',
      step: 'nfe_preconditions',
      details: { missing: ['crt', 'state_registration'] },
      retryable: false,
      category: 'CONFIGURATION',
    };
    const body = await failure(run(setup({ blocked }).service));
    expect(
      (body.details as Array<{ field: string }>).map((d) => d.field),
    ).toEqual(['crt', 'state_registration']);
  });

  it('asks for the city name of the company, which the XML needs', async () => {
    const { service } = setup({ company: company({ addressCity: undefined }) });
    expect(await failure(run(service))).toMatchObject({
      code: 'COMPANY_NFE_INCOMPLETE',
      type: 'configuration',
      details: [expect.objectContaining({ field: 'address_city' })],
    });
  });

  it('returns every validation issue at once with type validation', async () => {
    const input = inputFixture({ payments: [{ tPag: '17', amount: 1 }] });
    input.items = [{ ...input.items[0], ncm: '1' }];
    const body = await failure(run(setup().service, false, input));
    expect(body).toMatchObject({
      code: 'NFE_VALIDATION_FAILED',
      type: 'validation',
    });
    expect(
      (body.details as Array<{ field: string }>).map((d) => d.field),
    ).toEqual(['items[0].ncm', 'payments']);
  });

  it('reports an XSD failure as a validation error on the xml', async () => {
    const schema: SchemaValidator = {
      validate: () =>
        Promise.resolve({
          ok: false as const,
          errors: [{ line: 1, message: "Element 'x': not expected" }],
        }),
    };
    const body = await failure(run(setup({ schema }).service));
    expect(body).toMatchObject({
      type: 'validation',
      details: [
        {
          field: 'xml',
          code: 'NFE_SCHEMA_INVALID',
          message: "Element 'x': not expected",
        },
      ],
    });
  });
});
