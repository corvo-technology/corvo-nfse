import { Inject, Injectable } from '@nestjs/common';
import type { NfeSubmitted } from '@/modules/nfe/application/nfe-intake.service';
import type { PreparedNfe } from '@/modules/nfe/application/nfe-preparation.service';
import { nfeRequestHash } from '@/modules/nfe/application/nfe-request-hash';
import { NfeResubmitService } from '@/modules/nfe/application/nfe-resubmit.service';
import type { NfeDocument } from '@/modules/nfe/domain/nfe-document';
import { INfeDocumentRepository } from '@/modules/nfe/domain/nfe-document.repository';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfceInput } from '../domain/nfce-input';
import { NfceOfflineService } from './nfce-offline.service';
import { NfcePreparation } from './nfce-preparation.service';

/**
 * What the customer can do with a rejected NFC-e: correct it and send it again (`PUT
 * /v1/invoices/{id}`) or give it up (`POST /v1/invoices/{id}/discard`). Same rules as the NF-e, with
 * the checks of model 65.
 */
@Injectable()
export class NfceResubmitService {
  constructor(
    private readonly preparation: NfcePreparation,
    private readonly resubmission: NfeResubmitService,
    private readonly offline: NfceOfflineService,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
  ) {}

  /**
   * A rejected off-line NFC-e is rebuilt with the very same key and goes back to `contingency_pending`
   * (only the fields that carry no value may change, see `lockedFieldsChanged`); any other rejected
   * NFC-e is queued again with a new key.
   */
  async resubmit(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfceInput,
  ): Promise<NfeSubmitted> {
    const current = await this.documents.findById(id, tenantId, environment, {
      model: 65,
    });
    const offline =
      current?.status === 'rejected' && current.toSnapshot().tpEmis === 9;
    let rebuild:
      ((locked: NfeDocument, prepared: PreparedNfe) => void) | undefined;
    return this.resubmission.resubmitWith(id, tenantId, environment, {
      companyId: input.companyId,
      requestHash: nfeRequestHash({ model: 65, ...input }),
      prepare: async () => {
        const prepared = await this.preparation.prepare(
          tenantId,
          environment,
          input,
        );
        if (offline)
          rebuild = await this.offline.rebuilder(
            prepared,
            tenantId,
            environment,
          );
        return prepared;
      },
      model: 65,
      rebuildOffline: (locked, prepared) => rebuild?.(locked, prepared),
    });
  }

  discard(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeDocument> {
    return this.resubmission.discard(id, tenantId, environment, 65);
  }
}
