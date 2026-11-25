import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateInvoiceDto,
  InvoiceOptionsDto,
  ListInvoicesQuery,
} from './invoice.dto';

describe('InvoiceOptionsDto emission type', () => {
  it.each(['IMMEDIATE', 'SCHEDULE', undefined])('accepts %s', async (type) => {
    expect(
      await validate(plainToInstance(InvoiceOptionsDto, { type })),
    ).toEqual([]);
  });
  it.each(['LATER', 1])('rejects %s', async (type) => {
    const errors = await validate(plainToInstance(InvoiceOptionsDto, { type }));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'type',
          constraints: expect.objectContaining({ isIn: expect.any(String) }),
        }),
      ]),
    );
  });
});

describe('CreateInvoiceDto optional customer, discount and fiscal input', () => {
  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      companyId: '01927de2-1234-7890-abcd-ef0123456789',
      service: { code: '010101', municipalityCode: '3550308' },
      amount: 100.5,
      competenceDate: '2026-01-01',
      ...overrides,
    };
  }

  const errorsOf = (body: Record<string, unknown>) =>
    validate(plainToInstance(CreateInvoiceDto, body));

  /** Flattens nested (ValidateNested) error property paths. */
  const errorProperties = (
    errors: Awaited<ReturnType<typeof errorsOf>>,
  ): string[] =>
    errors.flatMap((error) => [
      error.property,
      ...errorProperties(error.children ?? []),
    ]);

  it('accepts a missing customer', async () => {
    expect(await errorsOf(validBody())).toEqual([]);
  });

  it('accepts an empty customer object', async () => {
    expect(await errorsOf(validBody({ customer: {} }))).toEqual([]);
  });

  it('accepts a partial customer without taxId', async () => {
    expect(await errorsOf(validBody({ customer: { name: 'Ana' } }))).toEqual(
      [],
    );
  });

  it('accepts a decimal discount', async () => {
    expect(await errorsOf(validBody({ discount: 10.5 }))).toEqual([]);
  });

  it('accepts a decimal deduction', async () => {
    expect(await errorsOf(validBody({ deduction: 40.5 }))).toEqual([]);
  });

  it('rejects a non-numeric deduction', async () => {
    const errors = await errorsOf(validBody({ deduction: 'quarenta' }));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'deduction' }),
      ]),
    );
  });

  it('rejects a non-numeric discount', async () => {
    const errors = await errorsOf(validBody({ discount: 'dez' }));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'discount' }),
      ]),
    );
  });

  it.each([
    ['nbsCode', '010101001'],
    ['cst', '001'],
    ['classCode', '010601'],
    ['operationIndicator', '000001'],
  ])('accepts a valid service.fiscal.%s', async (field, value) => {
    expect(
      await errorsOf(validBody({ service: { fiscal: { [field]: value } } })),
    ).toEqual([]);
  });

  it.each([
    ['nbsCode', '123'],
    ['cst', '12'],
    ['classCode', '12345'],
    ['operationIndicator', '12345'],
  ])('rejects an invalid service.fiscal.%s format', async (field, value) => {
    const errors = await errorsOf(
      validBody({ service: { fiscal: { [field]: value } } }),
    );
    expect(errorProperties(errors)).toContain(field);
  });

  it('accepts a UUID serviceProfileId', async () => {
    expect(
      await errorsOf(
        validBody({
          service: { serviceProfileId: '01927de2-1234-7890-abcd-ef0123456789' },
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a non-UUID serviceProfileId', async () => {
    const errors = await errorsOf(
      validBody({ service: { serviceProfileId: 'nope' } }),
    );
    expect(errorProperties(errors)).toContain('serviceProfileId');
  });

  it('accepts a 7-digit customer address municipalityCode', async () => {
    expect(
      await errorsOf(
        validBody({ customer: { address: { municipalityCode: '3550308' } } }),
      ),
    ).toEqual([]);
  });

  it('rejects an invalid customer address municipalityCode', async () => {
    const errors = await errorsOf(
      validBody({ customer: { address: { municipalityCode: '35503' } } }),
    );
    expect(errorProperties(errors)).toContain('municipalityCode');
  });
});

describe('CreateInvoiceDto inputs that used to crash after validation', () => {
  const body = (overrides: Record<string, unknown> = {}) =>
    plainToInstance(CreateInvoiceDto, {
      companyTaxId: '11222333000181',
      service: { code: '010101' },
      amount: 10,
      competenceDate: '2026-01-01',
      ...overrides,
    });
  const failing = async (overrides: Record<string, unknown>) =>
    (await validate(body(overrides))).map((error) => error.property);

  it('rejects an externalId longer than the 100 characters the column holds', async () => {
    expect(await failing({ externalId: 'x'.repeat(101) })).toContain(
      'externalId',
    );
    expect(await failing({ externalId: 'x'.repeat(100) })).toEqual([]);
  });

  it('rejects a companyId that is not a UUID even when companyTaxId is also sent', async () => {
    expect(await failing({ companyId: 'abc' })).toContain('companyId');
    expect(
      await failing({ companyId: '01927de2-1234-7890-abcd-ef0123456789' }),
    ).toEqual([]);
  });
});

describe('ListInvoicesQuery customerTaxId', () => {
  const check = async (customerTaxId: string) =>
    (await validate(plainToInstance(ListInvoicesQuery, { customerTaxId }))).map(
      (error) => error.property,
    );

  it.each(['52998224725', '11222333000181'])('accepts %s', async (value) => {
    expect(await check(value)).toEqual([]);
  });
  it.each(['529.982.247-25', '123', "1' OR '1'='1"])(
    'rejects %s',
    async (value) => {
      expect(await check(value)).toContain('customerTaxId');
    },
  );
});

describe('ListInvoicesQuery origin', () => {
  const check = async (origin: string) =>
    (await validate(plainToInstance(ListInvoicesQuery, { origin }))).map(
      (error) => error.property,
    );

  it.each(['dashboard', 'api', 'integration', 'schedule', 'import'])(
    'accepts %s',
    async (value) => {
      expect(await check(value)).toEqual([]);
    },
  );
  it('rejects an unknown origin', async () => {
    expect(await check('charge')).toContain('origin');
  });
});
