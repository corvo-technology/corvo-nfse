import { Inject, Injectable, Logger } from '@nestjs/common';
import { dhEmiFor, UF_TABLE } from '@/infra/external/nfe/sefaz/uf';
import {
  adviseContingency,
  FISCAL_SITUATION_READER,
  type FiscalSituationReader,
} from '@/modules/fiscal-core/domain/fiscal-situation';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { nfeBreakerAuthority } from '@/modules/invoice/application/fiscal-portal-breaker';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { TypeormNfeContingencyStates } from '../infra/typeorm-nfe-contingency-states';
import { NfeSvcAnnouncer } from './nfe-svc.announcer';

/** The justification written in `xJust` of every note issued in the SVC (15 to 256 characters). */
export const SVC_X_JUST = 'SEFAZ de origem indisponivel';

/** Whether a SEFAZ authority answers right now. `tpEmis` 1 asks the origin, 6 and 7 ask the SVC. */
export interface SefazStatusPort {
  isUp(uf: Uf, tpAmb: 1 | 2, tpEmis: 1 | 6 | 7): Promise<boolean>;
}
export const SEFAZ_STATUS = Symbol('SEFAZ_STATUS');

export type SvcSwitchResult = 'entered' | 'exited' | 'unchanged';

/** Consecutive minutes of `authority_down` before a UF enters the SVC (one bad probe is noise). */
export const ENTER_AFTER = 3;
/** Consecutive healthy minutes (breaker closed, origin answering) before a UF leaves the SVC. */
export const LEAVE_AFTER = 3;

const environmentOf = (tpAmb: 1 | 2): ExecutionEnvironment =>
  tpAmb === 1 ? 'live' : 'test';

/**
 * Decides, per UF and environment, whether the NF-e goes through the SVC.
 *
 * Enters only when the situation is `authority_down` (the origin SEFAZ is out while the rest of the
 * government answers: our own network failing never sends a note to the SVC, which is a government
 * host too) and the SVC of the UF answers. Leaves when the origin is back (breaker closed, probes
 * normal) and answers. Every transition is a single conditional write, so two workers racing
 * announce it once.
 */
@Injectable()
export class NfeSvcSwitchService {
  private readonly logger = new Logger(NfeSvcSwitchService.name);

  /** Consecutive evaluations that went the same way, per `uf-tpAmb` (memory of this process). */
  private readonly streaks = new Map<string, number>();

  constructor(
    private readonly states: TypeormNfeContingencyStates,
    @Inject(FISCAL_SITUATION_READER)
    private readonly reader: FiscalSituationReader,
    @Inject(SEFAZ_STATUS) private readonly status: SefazStatusPort,
    private readonly announcer: NfeSvcAnnouncer,
  ) {}

  async evaluate(
    uf: Uf,
    tpAmb: 1 | 2,
    now: Date = new Date(),
  ): Promise<SvcSwitchResult> {
    const info = UF_TABLE[uf];
    const environment = environmentOf(tpAmb);
    const current = await this.states.get(uf, tpAmb);
    const origin = await this.reader.situation({
      authority: nfeBreakerAuthority(info.authorizer55, tpAmb),
      environment,
    });
    const advice = adviseContingency(origin);

    const key = `${uf}-${tpAmb}`;
    // Counts only the evaluations that point the same way as the current state wants to change.
    const streak = (agrees: boolean): number => {
      const next = agrees ? (this.streaks.get(key) ?? 0) + 1 : 0;
      this.streaks.set(key, next);
      return next;
    };

    if (current.mode === 'none') {
      // "Unknown" (no probe, not enough signal) is `normal` here: it never counts as down.
      if (streak(advice === 'authority_down') < ENTER_AFTER) return 'unchanged';
      const svc = await this.reader.situation({
        authority: nfeBreakerAuthority(info.svc, tpAmb),
        environment,
      });
      if (svc.breakerOpen) return 'unchanged';
      const svcTpEmis = info.svc === 'SVCAN' ? 6 : 7;
      if (!(await this.status.isUp(uf, tpAmb, svcTpEmis))) return 'unchanged';
      const dhCont = dhEmiFor(uf, now);
      const won = await this.states.enter(
        uf,
        tpAmb,
        { dhCont, xJust: SVC_X_JUST },
        now,
      );
      if (!won) return 'unchanged';
      this.streaks.delete(key);
      this.logger.warn(
        { uf, tpAmb, authority: info.svc },
        'NF-e entered the SVC',
      );
      await this.announcer.entered({
        uf,
        tpAmb,
        authority: info.svc,
        dhCont,
      });
      return 'entered';
    }

    const healthy =
      advice === 'normal' && (await this.status.isUp(uf, tpAmb, 1));
    if (streak(healthy) < LEAVE_AFTER) return 'unchanged';
    this.streaks.delete(key);
    return this.leave(uf, tpAmb, now);
  }

  /**
   * Leaves the SVC with no webhook and no e-mail: for a UF no company uses any more, so nobody
   * needs to hear about it (it was entered on a probe nobody depended on).
   */
  async clearSilently(
    uf: Uf,
    tpAmb: 1 | 2,
    now: Date = new Date(),
  ): Promise<boolean> {
    this.streaks.delete(`${uf}-${tpAmb}`);
    if (!(await this.states.exit(uf, tpAmb, now))) return false;
    this.logger.warn(
      { uf, tpAmb },
      'NF-e SVC cleared: no company uses this UF and environment',
    );
    return true;
  }

  /** The platform admin's button: leaves the SVC even if the origin does not look healthy yet. */
  async forceExit(
    uf: Uf,
    tpAmb: 1 | 2,
    actor: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    return (await this.leave(uf, tpAmb, now, actor)) === 'exited';
  }

  private async leave(
    uf: Uf,
    tpAmb: 1 | 2,
    now: Date,
    by?: string,
  ): Promise<SvcSwitchResult> {
    const before = await this.states.get(uf, tpAmb);
    if (!(await this.states.exit(uf, tpAmb, now))) return 'unchanged';
    this.logger.warn(
      { uf, tpAmb, forced: by !== undefined },
      'NF-e left the SVC',
    );
    await this.announcer.exited({
      uf,
      tpAmb,
      authority: UF_TABLE[uf].svc,
      dhCont: before.dhCont,
      by,
    });
    return 'exited';
  }
}
