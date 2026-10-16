import 'reflect-metadata';
import { createNfseIssueHandler } from './nfse-issue.tool';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import type { AuthContext } from '@/modules/auth/auth-context';

describe('MCP invoice fiscal defaults', () => {
  it('forwards omitted defaults and explicit overrides to the shared invoice service', async () => {
    const emit = jest
      .fn()
      .mockResolvedValue({ id: 'invoice-1', status: 'queued' });
    const handler = createNfseIssueHandler({
      emit,
    } as unknown as InvoiceService);
    const context = {
      tenantId: 'tenant-1',
      executionEnvironment: 'test',
    } as AuthContext;
    const input = {
      company_id: '09947127-2702-4f6d-9da8-cb463608d812',
      customer: { name: 'Cliente', tax_id: '52998224725' },
      services: [{ description: 'Serviço', quantity: 1, unit_price: 100 }],
      competence_date: '2026-01-01',
    };
    await handler(input, context);
    expect(emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        service: {
          code: undefined,
          municipalityCode: undefined,
          description: 'Serviço',
        },
      }),
      'tenant-1',
      context,
      undefined,
    );
    await handler(
      { ...input, service_code: '010201', municipality_code: '3170206' },
      context,
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        service: {
          code: '010201',
          municipalityCode: '3170206',
          description: 'Serviço',
        },
      }),
      'tenant-1',
      context,
      undefined,
    );
  });
});

describe('nfse_issue simple inputs', () => {
  const context = {
    tenantId: 'tenant-1',
    executionEnvironment: 'test',
  } as AuthContext;
  const setup = () => {
    const emit = jest.fn().mockResolvedValue({
      id: 'invoice-1',
      accessKey: null,
      status: 'queued',
    });
    const handler = createNfseIssueHandler({
      emit,
    } as unknown as InvoiceService);
    return { emit, handler };
  };
  const dtoOf = (emit: jest.Mock): Record<string, unknown> =>
    (emit.mock.calls as unknown[][])[0][0] as Record<string, unknown>;

  it('issues with just the company CNPJ and an amount', async () => {
    const { emit, handler } = setup();
    const result = await handler(
      { company_tax_id: '11.222.333/0001-81', amount: 150 },
      context,
    );
    expect(result).toEqual({
      invoice_id: 'invoice-1',
      access_key: '',
      status: 'queued',
    });
    const dto = dtoOf(emit);
    expect(dto).toMatchObject({
      companyTaxId: '11.222.333/0001-81',
      amount: 150,
      customer: undefined,
      options: undefined,
    });
    expect(dto.companyId).toBeUndefined();
    expect(dto.competenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps an explicit competence date and passes description, discount and external id', async () => {
    const { emit, handler } = setup();
    await handler(
      {
        company_tax_id: '11222333000181',
        amount: 100,
        description: 'Consultoria',
        discount: 10,
        competence_date: '2026-10-01',
        external_id: 'order-42',
      },
      context,
    );
    expect(dtoOf(emit)).toMatchObject({
      competenceDate: '2026-10-01',
      discount: 10,
      externalId: 'order-42',
      service: expect.objectContaining({ description: 'Consultoria' }),
    });
  });

  it('maps the schedule and email options', async () => {
    const { emit, handler } = setup();
    await handler(
      {
        company_tax_id: '11222333000181',
        amount: 100,
        competence_date: '2026-12-01',
        emission_type: 'SCHEDULE',
        send_email: true,
      },
      context,
    );
    expect(dtoOf(emit).options).toEqual({
      type: 'SCHEDULE',
      email: { send: true },
    });
  });

  it('treats an empty customer as an anonymous consumer', async () => {
    const { emit, handler } = setup();
    await handler(
      { company_tax_id: '11222333000181', amount: 10, customer: {} },
      context,
    );
    expect(dtoOf(emit).customer).toBeUndefined();
  });

  it('accepts a customer with only a tax id', async () => {
    const { emit, handler } = setup();
    await handler(
      {
        company_tax_id: '11222333000181',
        amount: 10,
        customer: { tax_id: '00202989000116' },
      },
      context,
    );
    expect(dtoOf(emit).customer).toMatchObject({ taxId: '00202989000116' });
  });

  it('still sums itemized services and rounds to cents', async () => {
    const { emit, handler } = setup();
    await handler(
      {
        company_tax_id: '11222333000181',
        services: [
          { description: 'A', quantity: 3, unit_price: 0.1 },
          { description: 'B', quantity: 1, unit_price: 10 },
        ],
      },
      context,
    );
    expect(dtoOf(emit)).toMatchObject({
      amount: 10.3,
      service: expect.objectContaining({ description: 'A; B' }),
    });
  });

  it('requires a company reference', async () => {
    const { handler } = setup();
    await expect(handler({ amount: 10 }, context)).rejects.toThrow(
      /company_id/,
    );
  });

  it('requires an amount or services', async () => {
    const { handler } = setup();
    await expect(
      handler({ company_tax_id: '11222333000181' }, context),
    ).rejects.toThrow(/amount/);
  });

  it('rejects sending both amount and services', async () => {
    const { handler } = setup();
    await expect(
      handler(
        {
          company_tax_id: '11222333000181',
          amount: 10,
          services: [{ description: 'A', quantity: 1, unit_price: 10 }],
        },
        context,
      ),
    ).rejects.toThrow(/either amount or services/);
  });

  it('explains which nested field is wrong', async () => {
    const { handler } = setup();
    await expect(
      handler(
        {
          company_tax_id: '11222333000181',
          amount: 10,
          customer: { email: 'not-an-email' },
        },
        context,
      ),
    ).rejects.toThrow(/customer\.email/);
  });
});
