import { Injectable } from '@nestjs/common';
import {
  NfeIntakeService,
  type NfeSubmitted,
} from '@/modules/nfe/application/nfe-intake.service';
import { nfeRequestHash } from '@/modules/nfe/application/nfe-request-hash';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfceInput } from '../domain/nfce-input';
import { NfcePreparation } from './nfce-preparation.service';

/**
 * `POST /v1/invoices` (`type: "nfce"`): the NFC-e goes through the NF-e intake (replay by
 * `Idempotency-Key`, one transaction with the document, the credit and the `nfe.emit` message),
 * with the preconditions and validators of model 65 and `model: 65` on the document.
 */
@Injectable()
export class NfceIntakeService {
  constructor(
    private readonly preparation: NfcePreparation,
    private readonly intake: NfeIntakeService,
  ) {}

  submit(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: NfceInput,
    idempotencyKey: string,
  ): Promise<NfeSubmitted> {
    return this.intake.submitWith({
      tenantId,
      environment,
      companyId: input.companyId,
      idempotencyKey,
      // The model is part of the hash: the same key with an NF-e body is a different request.
      requestHash: nfeRequestHash({ model: 65, ...input }),
      model: 65,
      prepare: () => this.preparation.prepare(tenantId, environment, input),
    });
  }
}
