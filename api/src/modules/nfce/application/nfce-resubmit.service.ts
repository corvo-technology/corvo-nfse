import { Injectable } from '@nestjs/common';
import type { NfeSubmitted } from '@/modules/nfe/application/nfe-intake.service';
import { nfeRequestHash } from '@/modules/nfe/application/nfe-request-hash';
import { NfeResubmitService } from '@/modules/nfe/application/nfe-resubmit.service';
import type { NfeDocument } from '@/modules/nfe/domain/nfe-document';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfceInput } from '../domain/nfce-input';
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
  ) {}

  resubmit(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfceInput,
  ): Promise<NfeSubmitted> {
    return this.resubmission.resubmitWith(id, tenantId, environment, {
      companyId: input.companyId,
      requestHash: nfeRequestHash({ model: 65, ...input }),
      prepare: () => this.preparation.prepare(tenantId, environment, input),
      model: 65,
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
