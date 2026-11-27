import { nfeLifecycle } from './nfe-lifecycle';
import type { NfeStatus } from './nfe-status';

const base = {
  status: 'authorized' as NfeStatus,
  documentsReadyAt: null as Date | null,
  sendEmail: false,
  recipient: null,
  emailStatus: null as string | null,
};

describe('nfeLifecycle', () => {
  it('is pending while the note is in flight', () => {
    expect(nfeLifecycle({ ...base, status: 'queued' })).toMatchObject({
      documentsStatus: 'pending',
      stage: 'pending',
    });
    expect(nfeLifecycle({ ...base, status: 'processing' }).stage).toBe(
      'pending',
    );
  });

  it('is authorized until the XML and the DANFE are stored', () => {
    expect(nfeLifecycle(base)).toMatchObject({
      documentsStatus: 'pending',
      stage: 'authorized',
    });
  });

  it('is completed once the documents are ready and no e-mail was asked', () => {
    expect(
      nfeLifecycle({ ...base, documentsReadyAt: new Date() }),
    ).toMatchObject({ documentsStatus: 'ready', stage: 'completed' });
  });

  it('waits for the requested e-mail, then completes', () => {
    const asked = {
      ...base,
      documentsReadyAt: new Date(),
      sendEmail: true,
      recipient: { email: 'a@b.co' } as never,
    };
    expect(nfeLifecycle({ ...asked, emailStatus: 'queued' }).stage).toBe(
      'documents_ready',
    );
    expect(nfeLifecycle({ ...asked, emailStatus: 'sent' }).stage).toBe(
      'completed',
    );
  });

  it('is failed for denied/rejected/discarded and cancelled for cancelled', () => {
    for (const status of ['denied', 'rejected', 'discarded'] as const)
      expect(nfeLifecycle({ ...base, status }).stage).toBe('failed');
    expect(
      nfeLifecycle({
        ...base,
        status: 'cancelled',
        documentsReadyAt: new Date(),
      }),
    ).toMatchObject({ documentsStatus: 'ready', stage: 'cancelled' });
  });
});
