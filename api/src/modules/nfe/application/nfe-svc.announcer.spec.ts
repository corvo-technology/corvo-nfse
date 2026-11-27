import { ConfigService } from '@nestjs/config';
import { NfeSvcAnnouncer } from './nfe-svc.announcer';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const change = {
  uf: 'SP' as const,
  tpAmb: 2 as const,
  authority: 'SVCAN' as const,
  dhCont: '2026-11-26T12:00:00-03:00',
};

function setup(opsEmails = 'ops@corvo.test, outro@corvo.test') {
  const seen = new Set<string>();
  const redis = {
    set: jest.fn((key: string) => {
      if (seen.has(key)) return Promise.resolve(null);
      seen.add(key);
      return Promise.resolve('OK');
    }),
  };
  const audience = {
    tenants: jest.fn(() => Promise.resolve([T1, T2, T3])),
  };
  const webhooks = { publishTenantEvent: jest.fn(() => Promise.resolve()) };
  const email = { enqueueNotice: jest.fn(() => Promise.resolve()) };
  const announcer = new NfeSvcAnnouncer(
    audience as never,
    webhooks as never,
    email as never,
    new ConfigService({ OPS_ALERT_EMAILS: opsEmails }),
    redis as never,
  );
  return { announcer, audience, webhooks, email, redis };
}

describe('NfeSvcAnnouncer', () => {
  it('tells every workspace of the UF, once each, in the environment of the change', async () => {
    const t = setup();
    await t.announcer.entered(change);
    expect(t.audience.tenants).toHaveBeenCalledWith('SP', 2);
    expect(t.webhooks.publishTenantEvent.mock.calls).toEqual([
      [
        T1,
        'test',
        'nfe.contingency.entered',
        {
          uf: 'SP',
          tpAmb: 2,
          authority: 'SVCAN',
          dhCont: '2026-11-26T12:00:00-03:00',
        },
      ],
      [
        T2,
        'test',
        'nfe.contingency.entered',
        expect.objectContaining({ uf: 'SP' }),
      ],
      [
        T3,
        'test',
        'nfe.contingency.entered',
        expect.objectContaining({ uf: 'SP' }),
      ],
    ]);
  });

  it('says "live" for tpAmb 1 and uses the exited event on the way out', async () => {
    const t = setup();
    await t.announcer.exited({ ...change, tpAmb: 1 });
    expect(t.webhooks.publishTenantEvent).toHaveBeenCalledWith(
      T1,
      'live',
      'nfe.contingency.exited',
      expect.any(Object),
    );
  });

  it('e-mails every operator address, with no personal data of customers', async () => {
    const t = setup();
    await t.announcer.entered(change);
    expect(t.email.enqueueNotice).toHaveBeenCalledTimes(2);
    const [to, rendered] = t.email.enqueueNotice.mock.calls[0] as unknown as [
      string,
      { subject: string; text: string },
    ];
    expect(to).toBe('ops@corvo.test');
    expect(rendered.subject).toContain('SP');
    expect(rendered.text).toContain('SVC-AN');
  });

  it('tells who left the SVC by hand in the operator e-mail only', async () => {
    const t = setup();
    await t.announcer.exited({ ...change, by: 'admin@corvo.test' });
    const [, rendered] = t.email.enqueueNotice.mock.calls[0] as unknown as [
      string,
      { text: string },
    ];
    expect(rendered.text).toContain('admin@corvo.test');
    const payload = JSON.stringify(t.webhooks.publishTenantEvent.mock.calls);
    expect(payload).not.toContain('admin@corvo.test');
  });

  it('sends nothing by e-mail without recipients, and still publishes the webhooks', async () => {
    const t = setup('');
    await t.announcer.entered(change);
    expect(t.email.enqueueNotice).not.toHaveBeenCalled();
    expect(t.webhooks.publishTenantEvent).toHaveBeenCalled();
  });

  it('never throws: a failing audience or e-mail does not undo the transition', async () => {
    const t = setup();
    t.audience.tenants.mockRejectedValueOnce(new Error('db'));
    t.email.enqueueNotice.mockRejectedValue(new Error('smtp'));
    await expect(t.announcer.entered(change)).resolves.toBeUndefined();
  });

  it('e-mails an entered change once per UF and environment inside the cooldown', async () => {
    const t = setup('ops@corvo.test');
    await t.announcer.entered(change);
    await t.announcer.entered(change);
    expect(t.email.enqueueNotice).toHaveBeenCalledTimes(1);
    await t.announcer.entered({ ...change, uf: 'PE' });
    expect(t.email.enqueueNotice).toHaveBeenCalledTimes(2);
  });

  it('e-mails the exit once too, and still publishes every webhook', async () => {
    const t = setup('ops@corvo.test');
    await t.announcer.exited(change);
    await t.announcer.exited(change);
    expect(t.email.enqueueNotice).toHaveBeenCalledTimes(1);
    expect(t.webhooks.publishTenantEvent).toHaveBeenCalledTimes(6);
  });

  it('a manual exit by the admin is always e-mailed', async () => {
    const t = setup('ops@corvo.test');
    await t.announcer.exited(change);
    await t.announcer.exited({ ...change, by: 'ops@corvo.test' });
    expect(t.email.enqueueNotice).toHaveBeenCalledTimes(2);
  });
});
