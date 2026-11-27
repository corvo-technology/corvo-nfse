import { Injectable, NotFoundException } from '@nestjs/common';
import { isUf, UF_TABLE } from '@/infra/external/nfe/sefaz/uf';
import { NfeSvcSwitchService } from '@/modules/nfe/application/nfe-svc-switch.service';
import { TypeormNfeContingencyStates } from '@/modules/nfe/infra/typeorm-nfe-contingency-states';
import { PlatformAdminAuditRepository } from '../infra/platform-admin-audit.repository';
import type { PlatformSvcState } from '../platform-admin.contract';
import type { PlatformAdminActor } from '../platform-admin.guard';

const notFound = () =>
  new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message: 'Resource not found',
  });

/** The UFs whose NF-e is in the SVC, and the button that takes one of them out (audited). */
@Injectable()
export class PlatformContingencyService {
  constructor(
    private readonly states: TypeormNfeContingencyStates,
    private readonly switcher: NfeSvcSwitchService,
    private readonly audit: PlatformAdminAuditRepository,
  ) {}

  async list(): Promise<PlatformSvcState[]> {
    const active = await this.states.listActive();
    return active.map((row) => ({
      uf: row.uf,
      tpAmb: row.tpAmb,
      authority: UF_TABLE[row.uf].svc,
      enteredAt: row.enteredAt ? row.enteredAt.toISOString() : null,
      dhCont: row.dhCont,
    }));
  }

  /** `404` for a UF or environment that is not in the SVC: nothing is written then. */
  async forceExit(
    actor: PlatformAdminActor,
    ufInput: string,
    tpAmb: 1 | 2,
    reason: string,
  ): Promise<{ uf: string; tpAmb: 1 | 2; mode: 'none' }> {
    const uf = ufInput.toUpperCase();
    if (!isUf(uf)) throw notFound();
    if ((await this.states.get(uf, tpAmb)).mode !== 'svc') throw notFound();
    // The audit row comes first: if it cannot be written, the SVC is not left.
    await this.audit.insert({
      actorUserId: actor.authUserId,
      actorEmail: actor.email,
      action: 'svc_forced_exit',
      reason,
      payload: { uf, tpAmb },
      success: true,
      ipHash: actor.ipHash,
    });
    if (!(await this.switcher.forceExit(uf, tpAmb, actor.email)))
      throw notFound();
    return { uf, tpAmb, mode: 'none' };
  }
}
