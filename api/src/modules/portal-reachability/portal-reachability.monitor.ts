import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import {
  ENDPOINTS,
  ENDPOINTS_65,
  ENDPOINTS_SVC,
} from '@/infra/external/nfe/sefaz/endpoints';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import {
  NFE_ENABLED_AUTHORITIES,
  type NfeEnabledAuthorities,
} from '@/modules/fiscal-core/domain/nfe-enabled-authorities';
import type { LockPort } from '@/infra/redis/lock.port';
import { EmailService } from '@/modules/email/application/email.service';
import { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import { observeScheduledTask } from '@/shared/observability/scheduled-task-telemetry';
import { PortalAlertContext } from './portal-alert-context';
import { AuthorityReachabilityStore } from './authority-reachability.store';
import { authorityHosts } from './authority-hosts';
import {
  classifyProbes,
  type PortalHealth,
  type ProbeResults,
} from './reachability.classifier';
import {
  PROBE_LABELS,
  portalDownEmail,
  portalRecoveredEmail,
} from './reachability.email';
import { probeTcp } from './reachability.probe';
import { advance, type ReachabilityEvent } from './reachability.state';
import { PortalReachabilityStore } from './reachability.store';

const EMISSION_WINDOW_MS = 10 * 60_000;
const DEFAULT_EMISSION_FAILURES = 10;
const DEFAULT_CONTROL_HOST = '1.1.1.1';

/** The e-mails of the platform operator, from `OPS_ALERT_EMAILS` (comma-separated). */
export function opsAlertEmails(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * Every minute, checks that the Corvo servers can open a connection to the government NFS-e hosts
 * (TCP + TLS only: no certificate, no request) and tells the platform operator, not the customers,
 * when they cannot. The tests are compared with a government control and an outside control to tell
 * "the portal is down" from "our network cannot reach the government".
 *
 * It also counts real emission failures to connect (from the portal circuit breaker): too many in
 * 10 minutes raise the same alert even if the tests pass. An alert opens after 3 bad checks in a
 * row and closes after 2 good ones; one "down" e-mail per incident and one "recovered".
 */
@Injectable()
export class PortalReachabilityMonitor {
  private readonly logger = new Logger(PortalReachabilityMonitor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly store: PortalReachabilityStore,
    private readonly breaker: FiscalPortalBreaker,
    private readonly email: EmailService,
    private readonly context: PortalAlertContext,
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    @Inject(NFE_ENABLED_AUTHORITIES)
    private readonly enabled: NfeEnabledAuthorities,
    private readonly authorityStore: AuthorityReachabilityStore,
  ) {}

  @Cron('* * * * *')
  async handle(): Promise<void> {
    if (!(this.config.get<boolean>('PORTAL_PROBE_ENABLED') ?? true)) return;
    await observeScheduledTask('portal-reachability.monitor', () => this.run());
  }

  private async run(): Promise<void> {
    // One check per minute even with several workers.
    const lock = await this.locks.acquire('portal-reachability:run', {
      ttlMs: 50_000,
    });
    if (!lock) return;
    await this.check(await this.probe(), new Date());
  }

  async probe(): Promise<ProbeResults> {
    const control =
      this.config.get<string>('PORTAL_PROBE_CONTROL_HOST') ??
      DEFAULT_CONTROL_HOST;
    const [sefin, adn, govControl, externalControl, authorities] =
      await Promise.all([
        probeTcp('sefin.nfse.gov.br'),
        probeTcp('adn.nfse.gov.br'),
        probeTcp('www.gov.br'),
        probeTcp(control),
        this.probeAuthorities(),
      ]);
    return { sefin, adn, govControl, externalControl, authorities };
  }

  /**
   * One TCP probe per host of the enabled SEFAZ authorities (a host shared by two authorities is
   * probed once). Never throws: with no enabled UF, or if the list cannot be read, it is empty and
   * the NFS-e checks work as before.
   */
  private async probeAuthorities(): Promise<Record<string, boolean>> {
    try {
      const enabled = await this.enabled.listEnabled();
      const targets = authorityHosts(
        [...ENDPOINTS, ...ENDPOINTS_65, ...ENDPOINTS_SVC],
        enabled.map((row) => ({ ...row, uf: row.uf as Uf })),
      );
      const hosts = [...new Set(targets.map((target) => target.host))];
      const answers = new Map(
        await Promise.all(
          hosts.map(async (host) => [host, await probeTcp(host)] as const),
        ),
      );
      return Object.fromEntries(
        targets.map((target) => [target.authority, answers.get(target.host)!]),
      );
    } catch (error: unknown) {
      this.logger.warn(
        { err: error },
        'Could not probe the SEFAZ authorities this round',
      );
      return {};
    }
  }

  /** The health the emissions themselves report: ok unless too many calls failed to connect. */
  private async emissionHealth(): Promise<PortalHealth> {
    const threshold =
      this.config.get<number>('OPS_ALERT_EMISSION_FAILURES') ??
      DEFAULT_EMISSION_FAILURES;
    if (threshold <= 0) return 'ok';
    const failures = await this.breaker.recentFailures(
      'live',
      EMISSION_WINDOW_MS,
    );
    return failures >= threshold ? 'emission_failures' : 'ok';
  }

  /** Applies one round of results: updates the state and sends the alert when an incident opens or closes. */
  async check(
    probes: ProbeResults,
    now: Date,
  ): Promise<{ health: PortalHealth; event: ReachabilityEvent }> {
    if (probes.authorities) await this.saveAuthorities(probes.authorities, now);
    const probed = classifyProbes(probes);
    const health = probed !== 'ok' ? probed : await this.emissionHealth();
    const { state, event } = advance(await this.store.load(), health, now);
    await this.store.save(state);
    if (event?.type === 'opened') await this.alertDown(event, probes);
    if (event?.type === 'closed') await this.alertRecovered(event);
    return { health, event };
  }

  private async saveAuthorities(
    results: Record<string, boolean>,
    now: Date,
  ): Promise<void> {
    try {
      await this.authorityStore.save(results, now);
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Could not save the SEFAZ reachability');
    }
  }

  private async alertDown(
    event: Extract<ReachabilityEvent, { type: 'opened' }>,
    probes: ProbeResults,
  ): Promise<void> {
    const health = event.health as Exclude<PortalHealth, 'ok'>;
    const [waitingNotes, egressIp] = await Promise.all([
      this.context.waitingNotes(),
      this.context.egressIp(),
    ]);
    const failedProbes = (
      Object.keys(PROBE_LABELS) as Array<keyof ProbeResults>
    )
      .filter((name) => !probes[name])
      .map((name) => PROBE_LABELS[name]);
    for (const [authority, answered] of Object.entries(
      probes.authorities ?? {},
    ))
      if (!answered) failedProbes.push(authority);
    this.logger.error(
      { event: 'portal_unreachable', health, since: event.since, waitingNotes },
      'The Corvo servers cannot reach the government portal',
    );
    this.report(`portal ${health}`, 'error', health, {
      since: event.since,
      waitingNotes,
      egressIp,
      failedProbes,
    });
    const rendered = portalDownEmail({
      health,
      since: event.since,
      waitingNotes,
      egressIp,
      failedProbes,
    });
    await this.send(rendered);
  }

  private async alertRecovered(
    event: Extract<ReachabilityEvent, { type: 'closed' }>,
  ): Promise<void> {
    const health = event.health as Exclude<PortalHealth, 'ok'>;
    await this.store.recordIncident({
      health,
      start: event.since,
      end: event.until,
    });
    this.logger.log(
      { event: 'portal_reachable_again', health, since: event.since },
      'The Corvo servers reach the government portal again',
    );
    this.report('portal recovered', 'info', health, {
      since: event.since,
      until: event.until,
    });
    await this.send(
      portalRecoveredEmail({
        health,
        since: event.since,
        until: event.until,
      }),
    );
  }

  private async send(
    rendered: ReturnType<typeof portalDownEmail>,
  ): Promise<void> {
    const recipients = opsAlertEmails(
      this.config.get<string>('OPS_ALERT_EMAILS'),
    );
    if (recipients.length === 0) {
      this.logger.warn(
        { event: 'ops_alert_no_recipients' },
        'OPS_ALERT_EMAILS is empty: the alert was not e-mailed',
      );
      return;
    }
    for (const to of recipients) {
      try {
        await this.email.enqueueNotice(to, rendered);
      } catch (error: unknown) {
        this.logger.error(
          { err: error },
          'Could not queue the ops alert e-mail',
        );
      }
    }
  }

  private report(
    message: string,
    level: 'error' | 'info',
    health: PortalHealth,
    extra: Record<string, unknown>,
  ): void {
    try {
      Sentry.captureMessage(message, {
        level,
        tags: { alert: 'portal_reachability', classification: health },
        fingerprint: ['portal-reachability', health, level],
        extra,
      });
    } catch {
      // Reporting never breaks the monitor.
    }
  }
}
