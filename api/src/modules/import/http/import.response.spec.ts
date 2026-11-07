import {
  toImportResponse,
  toRowResponse,
  toStartResponse,
} from './import.response';

describe('import responses (snake_case like the rest of the API)', () => {
  it('maps an import with its counters', () => {
    const counters = {
      total: 3,
      valid: 2,
      invalid: 1,
      accepted: 0,
      authorized: 0,
      failed: 1,
      pending: 2,
    };
    const out = toImportResponse({
      id: 'i1',
      tenantId: 't',
      environment: 'live',
      userId: 'u',
      fileName: 'n.csv',
      fileHash: 'h',
      status: 'ready',
      companyId: 'c1',
      errorCode: null,
      emitStartedAt: null,
      emitFinishedAt: new Date('2026-11-07T10:00:00Z'),
      createdAt: new Date('2026-11-07T09:00:00Z'),
      counters,
    });
    expect(out).toEqual({
      id: 'i1',
      status: 'ready',
      file_name: 'n.csv',
      company_id: 'c1',
      error_code: null,
      emit_started_at: null,
      emit_finished_at: '2026-11-07T10:00:00.000Z',
      created_at: '2026-11-07T09:00:00.000Z',
      counters,
    });
  });

  it('never leaks the tenant, user or file hash', () => {
    const out = toImportResponse({
      id: 'i1',
      tenantId: 't',
      environment: 'live',
      userId: 'u',
      fileName: 'n.csv',
      fileHash: 'h',
      status: 'ready',
      companyId: null,
      errorCode: null,
      emitStartedAt: null,
      emitFinishedAt: null,
      createdAt: new Date(),
      counters: {
        total: 0,
        valid: 0,
        invalid: 0,
        accepted: 0,
        authorized: 0,
        failed: 0,
        pending: 0,
      },
    });
    expect(Object.keys(out)).not.toEqual(
      expect.arrayContaining(['tenantId', 'userId', 'fileHash']),
    );
    expect(JSON.stringify(out)).not.toMatch(/tenant|user|hash/i);
  });

  it('maps a row and the start answer', () => {
    expect(
      toRowResponse({
        line: 4,
        data: { amount: 1 },
        status: 'invalid',
        errorCode: 'ERROR_VALIDATION',
        errorMessage: 'bad',
        invoiceId: null,
      }),
    ).toEqual({
      line: 4,
      data: { amount: 1 },
      status: 'invalid',
      error_code: 'ERROR_VALIDATION',
      error_message: 'bad',
      invoice_id: null,
    });
    expect(
      toStartResponse({ id: 'i1', status: 'processing', duplicateOf: 'old' }),
    ).toEqual({ id: 'i1', status: 'processing', duplicate_of: 'old' });
  });
});
