import { ConflictException } from '@nestjs/common';
import { ScheduleNfeAdapter } from './schedule-nfe.adapter';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const body = {
  companyId: COMPANY,
  recipient: {
    taxId: '12345678909',
    name: 'Ana',
    indIeDest: 9,
    address: {
      street: 'Rua A',
      number: '1',
      district: 'Centro',
      zip: '01001000',
      cityCode: '3550308',
      city: 'São Paulo',
      state: 'SP',
    },
  },
  items: [
    {
      code: '1',
      description: 'Peça',
      ncm: '61091000',
      cfop: '5102',
      unit: 'UN',
      quantity: 1,
      unitPrice: 10,
    },
  ],
  payments: [{ tPag: '01', amount: 10 }],
};

function build() {
  const validation = { validate: jest.fn().mockResolvedValue({ valid: true }) };
  const intake = {
    submit: jest.fn().mockResolvedValue({ id: 'doc-1', replayed: false }),
  };
  const documents = { findByIdempotencyKey: jest.fn() };
  return {
    validation,
    intake,
    documents,
    adapter: new ScheduleNfeAdapter(
      validation as never,
      intake as never,
      documents as never,
    ),
  };
}

describe('ScheduleNfeAdapter', () => {
  it('validate runs the same dry-run as /invoices/validate and answers the company', async () => {
    const { adapter, validation } = build();
    await expect(adapter.validate('t1', 'test', body)).resolves.toEqual({
      companyId: COMPANY,
    });
    expect(validation.validate).toHaveBeenCalledWith(
      't1',
      'test',
      expect.objectContaining({ companyId: COMPANY }),
      false,
    );
  });

  it('validate refuses a malformed body (400) before any company check', async () => {
    const { adapter, validation } = build();
    await expect(
      adapter.validate('t1', 'test', { ...body, items: [] }),
    ).rejects.toThrow();
    expect(validation.validate).not.toHaveBeenCalled();
  });

  it('issue submits to the NF-e intake with the given key', async () => {
    const { adapter, intake } = build();
    await expect(adapter.issue('t1', 'live', body, 'k')).resolves.toEqual({
      id: 'doc-1',
    });
    expect(intake.submit).toHaveBeenCalledWith(
      't1',
      'live',
      expect.objectContaining({ companyId: COMPANY }),
      'k',
    );
  });

  it('a key already used by this same run (schedule edited meanwhile) answers the note it created', async () => {
    const { adapter, intake, documents } = build();
    intake.submit.mockRejectedValue(
      new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'x' }),
    );
    documents.findByIdempotencyKey.mockResolvedValue({ id: 'doc-0' });
    await expect(adapter.issue('t1', 'test', body, 'k')).resolves.toEqual({
      id: 'doc-0',
    });
  });

  it('any other conflict or error is not hidden', async () => {
    const { adapter, intake, documents } = build();
    intake.submit.mockRejectedValue(
      new ConflictException({ code: 'NFE_INVALID_STATE', message: 'x' }),
    );
    await expect(adapter.issue('t1', 'test', body, 'k')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(documents.findByIdempotencyKey).not.toHaveBeenCalled();
  });
});
