import type { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type { LockPort } from '@/infra/redis/lock.port';
import type { EmailService } from '@/modules/email/application/email.service';
import type { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import type { PortalAlertContext } from './portal-alert-context';
import {
  opsAlertEmails,
  PortalReachabilityMonitor,
} from './portal-reachability.monitor';
import type { ProbeResults } from './reachability.classifier';
import { portalDownEmail, portalRecoveredEmail } from './reachability.email';
import { INITIAL_STATE, type ReachabilityState } from './reachability.state';
import type {
  PortalIncident,
  PortalReachabilityStore,
} from './reachability.store';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

const up: ProbeResults = {
  sefin: true,
  adn: true,
  govControl: true,
  externalControl: true,
};
const govBlocked: ProbeResults = {
  sefin: false,
  adn: false,
  govControl: false,
  externalControl: true,
};

describe('PortalReachabilityMonitor', () => {
  let state: ReachabilityState;
  let incidents: PortalIncident[];
  let failures: number;
  let settings: Record<string, unknown>;
  const enqueueNotice = jest.fn();
  let clock: number;

  const build = () =>
    new PortalReachabilityMonitor(
      { get: (key: string) => settings[key] } as unknown as ConfigService,
      {
        load: async () => state,
        save: async (next: ReachabilityState) => {
          state = next;
        },
        recordIncident: async (incident: PortalIncident) => {
          incidents.push(incident);
          await Promise.resolve();
        },
      } as unknown as PortalReachabilityStore,
      {
        recentFailures: async () => failures,
      } as unknown as FiscalPortalBreaker,
      { enqueueNotice } as unknown as EmailService,
      {
        waitingNotes: async () => 7,
        egressIp: async () => '203.0.113.9',
      } as unknown as PortalAlertContext,
      {} as LockPort,
    );

  const tick = (monitor: PortalReachabilityMonitor, probes: ProbeResults) => {
    clock += 60_000;
    return monitor.check(probes, new Date(clock));
  };

  beforeEach(() => {
    state = INITIAL_STATE;
    incidents = [];
    failures = 0;
    clock = Date.UTC(2026, 10, 26, 12);
    settings = { OPS_ALERT_EMAILS: 'dono@corvo.tech, Socio@corvo.tech' };
    jest.clearAllMocks();
  });

  it('sends nothing while everything answers', async () => {
    const monitor = build();
    for (let i = 0; i < 5; i += 1) await tick(monitor, up);
    expect(enqueueNotice).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('sends one "down" e-mail per recipient after the third bad check, and only one per incident', async () => {
    const monitor = build();
    await tick(monitor, govBlocked);
    await tick(monitor, govBlocked);
    expect(enqueueNotice).not.toHaveBeenCalled();
    await tick(monitor, govBlocked);
    expect(enqueueNotice).toHaveBeenCalledTimes(2);
    expect(enqueueNotice.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'dono@corvo.tech',
      'socio@corvo.tech',
    ]);
    for (let i = 0; i < 6; i += 1) await tick(monitor, govBlocked);
    expect(enqueueNotice).toHaveBeenCalledTimes(2);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'portal gov_unreachable_from_us',
      expect.objectContaining({
        level: 'error',
        tags: {
          alert: 'portal_reachability',
          classification: 'gov_unreachable_from_us',
        },
      }),
    );
  });

  it('survives a restart: the incident lives in the stored state, so no second e-mail', async () => {
    await tick(build(), govBlocked);
    await tick(build(), govBlocked);
    await tick(build(), govBlocked);
    await tick(build(), govBlocked);
    expect(enqueueNotice).toHaveBeenCalledTimes(2);
  });

  it('sends one "recovered" e-mail with the duration after two good checks and records the incident', async () => {
    const monitor = build();
    for (let i = 0; i < 4; i += 1) await tick(monitor, govBlocked);
    enqueueNotice.mockClear();
    await tick(monitor, up);
    expect(enqueueNotice).not.toHaveBeenCalled();
    await tick(monitor, up);
    expect(enqueueNotice).toHaveBeenCalledTimes(2);
    const [, email] = enqueueNotice.mock.calls[0] as [
      string,
      { subject: string; text: string },
    ];
    expect(email.subject).toContain('voltou');
    expect(email.text).toContain('Duração: 5 min');
    expect(incidents).toEqual([
      {
        health: 'gov_unreachable_from_us',
        start: new Date(Date.UTC(2026, 10, 26, 12, 1)).toISOString(),
        end: new Date(Date.UTC(2026, 10, 26, 12, 6)).toISOString(),
      },
    ]);
    await tick(monitor, up);
    expect(enqueueNotice).toHaveBeenCalledTimes(2);
  });

  it('raises the alert from real emission failures even if the tests pass, and not below the threshold', async () => {
    const monitor = build();
    failures = 9;
    for (let i = 0; i < 4; i += 1) await tick(monitor, up);
    expect(enqueueNotice).not.toHaveBeenCalled();
    failures = 10;
    for (let i = 0; i < 3; i += 1) await tick(monitor, up);
    expect(enqueueNotice).toHaveBeenCalledTimes(2);
    expect(state.health).toBe('emission_failures');
  });

  it('can switch the emission signal off', async () => {
    settings.OPS_ALERT_EMISSION_FAILURES = 0;
    failures = 500;
    const monitor = build();
    for (let i = 0; i < 4; i += 1) await tick(monitor, up);
    expect(enqueueNotice).not.toHaveBeenCalled();
  });

  it('does not fail when nobody is configured to receive the e-mail', async () => {
    settings.OPS_ALERT_EMAILS = '';
    const monitor = build();
    for (let i = 0; i < 3; i += 1) await tick(monitor, govBlocked);
    expect(enqueueNotice).not.toHaveBeenCalled();
    expect(state.phase).toBe('incident');
  });

  it('parses the recipient list', () => {
    expect(opsAlertEmails(' A@x.com,b@x.com ,, a@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
    ]);
    expect(opsAlertEmails(undefined)).toEqual([]);
  });
});

describe('alert e-mails', () => {
  const since = '2026-11-26T15:00:00.000Z';

  it('explains our-network trouble in plain Portuguese with since, queue, egress IP and what to do', () => {
    const email = portalDownEmail({
      health: 'gov_unreachable_from_us',
      since,
      waitingNotes: 12,
      egressIp: '203.0.113.9',
      failedProbes: ['sefin.nfse.gov.br', 'adn.nfse.gov.br', 'www.gov.br'],
    });
    expect(email.text).toContain(
      'Os servidores da Corvo não alcançam a rede do governo; outros sites funcionam. Provável problema de rede do provedor (Guara).',
    );
    expect(email.text).toContain('Desde: 26/11/2026');
    expect(email.text).toContain('Notas esperando na fila: 12');
    expect(email.text).toContain('IP de saída dos servidores: 203.0.113.9');
    expect(email.text).toContain('Não respondem: sefin.nfse.gov.br');
    expect(email.text).toContain('abra um chamado na Guara');
    expect(email.html).toContain('203.0.113.9');
  });

  it('says the portal is down without blaming our provider', () => {
    const email = portalDownEmail({
      health: 'portal_down',
      since,
      waitingNotes: null,
      egressIp: null,
      failedProbes: ['sefin.nfse.gov.br'],
    });
    expect(email.subject).toContain('fora do ar');
    expect(email.text).not.toContain('Guara');
    expect(email.text).toContain(
      'Notas esperando na fila: não foi possível contar',
    );
    expect(email.text).not.toContain('IP de saída');
  });

  it('says how long the incident lasted', () => {
    const email = portalRecoveredEmail({
      health: 'no_internet',
      since,
      until: '2026-11-26T16:35:00.000Z',
    });
    expect(email.text).toContain('Duração: 1 h 35 min');
  });
});
