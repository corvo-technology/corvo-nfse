import { buildInvoiceState } from './invoice-state';

const base = {
  status: 'authorized' as const,
  documentsReady: false,
  emailRequested: false,
  emailStatus: null,
};

describe('buildInvoiceState', () => {
  it.each([
    'queued',
    'processing',
    'retry_pending',
    'reconciliation_required',
    'manual_review',
  ] as const)('is pending while fiscal status is %s', (status) => {
    expect(buildInvoiceState({ ...base, status }).stage).toBe('pending');
  });

  it.each(['rejected', 'failed'] as const)('is failed when %s', (status) => {
    expect(buildInvoiceState({ ...base, status }).stage).toBe('failed');
  });

  it('is authorized until documents are ready', () => {
    const state = buildInvoiceState(base);
    expect(state).toEqual({
      status: 'authorized',
      documentsStatus: 'pending',
      emailStatus: null,
      stage: 'authorized',
    });
  });

  it('is completed once documents are ready and no email was requested', () => {
    const state = buildInvoiceState({ ...base, documentsReady: true });
    expect(state.documentsStatus).toBe('ready');
    expect(state.stage).toBe('completed');
  });

  it('stays documents_ready while a requested email is unresolved', () => {
    for (const emailStatus of [null, 'queued'] as const) {
      expect(
        buildInvoiceState({
          ...base,
          documentsReady: true,
          emailRequested: true,
          emailStatus,
        }).stage,
      ).toBe('documents_ready');
    }
  });

  it.each(['sent', 'failed'] as const)(
    'is completed when the requested email is %s',
    (emailStatus) => {
      expect(
        buildInvoiceState({
          ...base,
          documentsReady: true,
          emailRequested: true,
          emailStatus,
        }).stage,
      ).toBe('completed');
    },
  );
});
