import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { InvoiceMapper } from './invoice.mapper';

describe('InvoiceMapper cancellation fields', () => {
  it.each([undefined, 0, 12.34, 100])(
    'preserves discount %s through persistence',
    (discount) => {
      const invoice = Invoice.create(
        {
          companyId: 'company-1',
          customer: { taxId: VALID_CNPJ, name: 'Cliente' },
          service: {
            description: 'Serviço',
            code: '010101',
            municipalityCode: '3550308',
          },
          amount: 100,
          discount,
          competenceDate: new Date('2026-10-14'),
        },
        'tenant-1',
      );
      const mapper = new InvoiceMapper();
      expect(mapper.toDomain(mapper.toPersistence(invoice)).discount).toBe(
        discount,
      );
    },
  );
  it('round-trips the cancellation reason, description and timestamp', () => {
    const invoice = Invoice.create(
      {
        companyId: 'company-1',
        customer: { taxId: VALID_CNPJ, name: 'Cliente' },
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2026-10-14'),
      },
      'tenant-1',
    );
    invoice.requestCancellation(
      cancellationReason('other', 'Cliente desistiu'),
    );
    const mapper = new InvoiceMapper();
    const orm = mapper.toPersistence(invoice);
    expect(orm.status).toBe('cancelled');
    expect(orm.cancellationReason).toBe('other');
    expect(orm.cancellationDescription).toBe('Cliente desistiu');
    expect(orm.cancelledAt).toEqual(invoice.cancelledAt);

    const back = mapper.toDomain(orm);
    expect(back.cancellationReason).toEqual({
      code: 'other',
      description: 'Cliente desistiu',
    });
    expect(back.cancelledAt).toEqual(invoice.cancelledAt);
  });

  it('maps a cleared last error to explicit nulls so the UPDATE erases it', () => {
    const invoice = Invoice.create(
      {
        companyId: 'company-1',
        customer: { taxId: VALID_CNPJ, name: 'Cliente' },
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2026-10-14'),
      },
      'tenant-1',
    );
    const orm = new InvoiceMapper().toPersistence(invoice);
    expect(orm.lastErrorCode).toBeNull();
    expect(orm.lastErrorMessage).toBeNull();
    expect(orm.lastErrorProvider).toBeNull();
  });

  it('maps absent cancellation columns to null', () => {
    const orm = new InvoiceMapper().toPersistence(
      Invoice.create(
        {
          companyId: 'company-1',
          customer: { taxId: VALID_CNPJ, name: 'Cliente' },
          service: {
            description: 'Serviço',
            code: '010101',
            municipalityCode: '3550308',
          },
          amount: 100,
          competenceDate: new Date('2026-10-14'),
        },
        'tenant-1',
      ),
    );
    orm.cancellationReason = undefined;
    orm.cancelledAt = undefined;
    const back = new InvoiceMapper().toDomain(orm);
    expect(back.cancellationReason).toBeNull();
    expect(back.cancelledAt).toBeNull();
  });

  it('round-trips cancellationRequestedAt, null and filled', () => {
    const invoice = Invoice.create(
      {
        companyId: 'company-1',
        customer: { taxId: VALID_CNPJ, name: 'Cliente' },
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2026-10-14'),
      },
      'tenant-1',
    );
    const mapper = new InvoiceMapper();
    const empty = mapper.toPersistence(invoice);
    expect(empty.cancellationRequestedAt).toBeNull();
    expect(mapper.toDomain(empty).cancellationRequestedAt).toBeNull();

    const at = new Date('2026-10-14T13:00:00Z');
    empty.cancellationRequestedAt = at;
    expect(mapper.toDomain(empty).cancellationRequestedAt).toEqual(at);
    expect(
      mapper.toPersistence(mapper.toDomain(empty)).cancellationRequestedAt,
    ).toEqual(at);
  });
});
