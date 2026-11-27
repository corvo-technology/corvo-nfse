import type { ConfigService } from '@nestjs/config';
import type { LockPort } from '@/infra/redis/lock.port';
import type { EmailService } from '@/modules/email/application/email.service';
import type { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import type { NfeEnabledAuthorities } from '@/modules/fiscal-core/domain/nfe-enabled-authorities';
import { probeViaProxy } from '@/infra/external/fiscal-proxy/gov-proxy';
import type { AuthorityReachabilityStore } from './authority-reachability.store';
import type { PortalAlertContext } from './portal-alert-context';
import { PortalReachabilityMonitor } from './portal-reachability.monitor';
import { probeTcp } from './reachability.probe';
import type { ProbeResults } from './reachability.classifier';
import { INITIAL_PROXY_STATE, type ProxyRouteState } from './proxy-route.state';
import { INITIAL_STATE, type ReachabilityState } from './reachability.state';
import type { PortalReachabilityStore } from './reachability.store';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));
jest.mock('./reachability.probe', () => ({ probeTcp: jest.fn() }));
jest.mock('@/infra/external/fiscal-proxy/gov-proxy', () => ({
  probeViaProxy: jest.fn(),
  redactProxyUrl: (raw: string) => raw.replace(/\/\/[^@]*@/, '//***@'),
}));

const PROXY = 'http://corvo:s3cret@proxy.example.com:3128';
const base = {
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

describe('PortalReachabilityMonitor: backup proxy', () => {
  let state: ReachabilityState;
  let proxyState: ProxyRouteState;
  let settings: Record<string, unknown>;
  let clock: number;
  const enqueueNotice = jest.fn();

  const build = () =>
    new PortalReachabilityMonitor(
      { get: (key: string) => settings[key] } as unknown as ConfigService,
      {
        load: async () => state,
        save: async (next: ReachabilityState) => {
          state = next;
          await Promise.resolve();
        },
        recordIncident: async () => undefined,
        loadProxy: async () => proxyState,
        saveProxy: async (next: ProxyRouteState) => {
          proxyState = next;
          await Promise.resolve();
        },
      } as unknown as PortalReachabilityStore,
      { recentFailures: async () => 0 } as unknown as FiscalPortalBreaker,
      { enqueueNotice } as unknown as EmailService,
      {
        waitingNotes: async () => 3,
        egressIp: async () => '203.0.113.9',
      } as unknown as PortalAlertContext,
      {} as LockPort,
      { listEnabled: async () => [] } as unknown as NfeEnabledAuthorities,
      { save: async () => undefined } as unknown as AuthorityReachabilityStore,
    );

  const tick = (
    monitor: PortalReachabilityMonitor,
    probes: ProbeResults,
    viaProxy?: boolean,
  ) => {
    clock += 60_000;
    return monitor.check(
      { ...probes, ...(viaProxy === undefined ? {} : { viaProxy }) },
      new Date(clock),
    );
  };
  const subjects = () =>
    enqueueNotice.mock.calls.map((call: unknown[]) =>
      String((call[1] as { subject: string }).subject),
    );

  beforeEach(() => {
    state = INITIAL_STATE;
    proxyState = INITIAL_PROXY_STATE;
    settings = {
      OPS_ALERT_EMAILS: 'dono@corvo.tech',
      FISCAL_HTTPS_PROXY: PROXY,
    };
    clock = Date.UTC(2026, 10, 26, 12);
    jest.clearAllMocks();
    (probeTcp as jest.Mock).mockResolvedValue(true);
    (probeViaProxy as jest.Mock).mockResolvedValue(true);
  });

  it('probes the Sefin through the proxy only when it is configured', async () => {
    await build().probe();
    expect(probeViaProxy).toHaveBeenCalledWith(PROXY, 'sefin.nfse.gov.br');
    jest.clearAllMocks();
    (probeTcp as jest.Mock).mockResolvedValue(true);
    settings = {};
    const probes = await build().probe();
    expect(probeViaProxy).not.toHaveBeenCalled();
    expect(probes.viaProxy).toBeUndefined();
  });

  it('the direct probes never go through the proxy', async () => {
    await build().probe();
    expect(probeTcp).toHaveBeenCalledWith('sefin.nfse.gov.br');
  });

  it('e-mails when the incident switches to the proxy and when it goes back to direct', async () => {
    const monitor = build();
    for (let i = 0; i < 3; i += 1) await tick(monitor, govBlocked, true);
    expect(subjects()).toEqual([
      '[Corvo] Os servidores da Corvo não alcançam o governo',
      '[Corvo] Chamadas ao governo passando pelo proxy de reserva',
    ]);
    await tick(monitor, base, true);
    await tick(monitor, base, true);
    expect(subjects().slice(2)).toEqual([
      '[Corvo] A conexão com o governo voltou',
      '[Corvo] Chamadas ao governo voltaram para a rota direta',
    ]);
  });

  it('says in the switch e-mail when the backup test failed', async () => {
    const monitor = build();
    for (let i = 0; i < 3; i += 1) await tick(monitor, govBlocked, false);
    const switchMail = JSON.stringify(enqueueNotice.mock.calls.at(-1));
    expect(switchMail).toContain('FALHOU');
  });

  it('does not send the proxy e-mails when the portal is down (not our network)', async () => {
    const monitor = build();
    const portalDown = { ...base, sefin: false, adn: false };
    for (let i = 0; i < 3; i += 1) await tick(monitor, portalDown, true);
    expect(subjects()).toEqual([
      '[Corvo] O portal da NFS-e do governo está fora do ar',
    ]);
  });

  it('does not send the proxy e-mails without a configured proxy', async () => {
    settings = { OPS_ALERT_EMAILS: 'dono@corvo.tech' };
    const monitor = build();
    for (let i = 0; i < 3; i += 1) await tick(monitor, govBlocked);
    expect(subjects()).toHaveLength(1);
  });

  it('warns once when the proxy breaks while all is well, and once when it is back', async () => {
    const monitor = build();
    for (let i = 0; i < 6; i += 1) await tick(monitor, base, false);
    expect(subjects()).toEqual([
      '[Corvo] O proxy de reserva não está respondendo',
    ]);
    await tick(monitor, base, true);
    await tick(monitor, base, true);
    expect(subjects()).toEqual([
      '[Corvo] O proxy de reserva não está respondendo',
      '[Corvo] O proxy de reserva voltou a responder',
    ]);
  });

  it('never puts the proxy credentials in an e-mail', async () => {
    const monitor = build();
    for (let i = 0; i < 3; i += 1) await tick(monitor, govBlocked, false);
    for (let i = 0; i < 4; i += 1) await tick(monitor, base, false);
    const all = JSON.stringify(enqueueNotice.mock.calls);
    expect(all).toContain('proxy.example.com:3128');
    expect(all).not.toContain('s3cret');
    expect(all).not.toContain('corvo:');
  });
});
