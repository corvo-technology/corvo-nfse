# Cancelamento de NFS-e e de emissão agendada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir cancelar uma NFS-e autorizada (evento 101101 na Sefin, assíncrono) e uma emissão ainda `queued` (local, síncrona), via API, dashboard e MCP.

**Architecture:** A regra fica no agregado `Invoice` (`requestCancellation` / `confirmCancellation` / `rejectCancellation`) e a persistência atômica no `InvoiceLifecycleService.transition()`, que passa a aceitar uma mensagem de outbox opcional. O cancelamento fiscal reaproveita o padrão da emissão: outbox `invoice.cancel` → `InvoiceCancelHandler` → BullMQ `nfse-cancellation` → `NfseCancellationProcessor` (lock Redis por invoice) → `NfseCancellationService` → `FiscalProvider.cancel()`. Os webhooks saem de um `InvoiceWebhookPublisher`, extraído do `NfseWorkflowService`. Uma corrida existente no workflow (o `save()` sobrescrevia o status) é corrigida para que uma nota cancelada nunca seja emitida.

**Tech Stack:** NestJS 11, TypeORM 0.3 (PostgreSQL, schema `corvo`, RLS), BullMQ 5, `open-nfse@0.11.0`, Jest 30 (api); Next.js, next-intl, Vitest + Testing Library (web).

**Spec:** `docs/superpowers/specs/2026-10-14-nfse-cancellation-design.md`

## Global Constraints

- Caminhos com prefixo `api/`, `web/` ou `docs/` são relativos à raiz do repositório. Comandos de backend rodam em `api/` (`yarn jest <arquivo>`). Comandos de frontend rodam em `web/` (`yarn vitest run <arquivo>`).
- Trabalhar na branch `feat/nfse-cancellation` (nunca commitar na `main`). Commits convencionais (`commitlint`), um por tarefa, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Status novos: exatamente `cancelling` e `cancelled`. Transições: `queued → cancelled`, `authorized → cancelling`, `cancelling → cancelled | authorized`.
- Motivos: `issue_error` → cMotivo `1`, `service_not_provided` → `2`, `other` → `9`. A descrição fiscal deve ter de 15 a 255 caracteres (depois do `trim`). Para `queued`, a descrição é opcional.
- Créditos (live): `queued → cancelled` estorna a reserva e chama `usage.settle(..., 'cancelled')`. Transições a partir de `authorized` não mexem em crédito nem billing.
- Endpoint: `POST /v1/invoices/:id/cancel`, permissão `nfse.invoices.issue`. Responde `200` quando o resultado é `cancelled` e `202` quando é `cancelling`.
- Erros HTTP: `409 ERROR_INVOICE_NOT_CANCELLABLE`, `409 ERROR_CONCURRENT_INVOICE_TRANSITION`, `422 ERROR_INVALID_CANCELLATION_REASON`. **Emenda (Task 12):** o endpoint de cancelamento deixa de responder `ERROR_CONCURRENT_INVOICE_TRANSITION`; a corrida vira `ERROR_INVOICE_NOT_CANCELLABLE` (ou o estado do vencedor, se outro pedido cancelou antes).
- Fila `nfse-cancellation`, job `cancel`, `jobId = cancellation-{eventId}`, attempts 8, backoffMs 60000 (exponencial, já padrão do `BullmqQueueService`), removeOnComplete false, removeOnFail 1000.
- Outbox: type `invoice.cancel`, `dedupeKey = cancellation:{eventId}`.
- Webhooks públicos novos: `nfse.invoice.cancelled` e `nfse.invoice.cancellation_rejected`.
- Migration nova: `1792400000000-AddInvoiceCancellation` (renumerada no merge com a main; a última existente na main é `1792300000000-AddCompanySendMunicipalReg`).
- Testes de Postgres só rodam com `MIGRATION_TEST_DATABASE_URL` (banco local terminado em `_test`). Sem a variável, ficam em `describe.skip`.
- Nunca chamar a Sefin real nos testes. `open-nfse` é mockado em `api/test/__mocks__/open-nfse.ts`.
- **Pré-requisito do ambiente:** `api/src/infra/storage/` é ignorado pela regra `storage/` do `.gitignore` da raiz. Se a pasta não existir no checkout, o build falha antes de qualquer tarefa. Pare e avise o usuário (não recrie o port).

## Review Focus

- **O worker pega uma nota `queued` no mesmo instante em que ela é cancelada.** A nota não pode ser emitida. Testado na Task 5 (`saveDpsInfo` + `ConcurrentInvoiceTransitionError` ignorado).
- **Mensagem `invoice.emit` de nota cancelada publicada depois** (agendamento chegando à data). O workflow não deve fazer nada. Testado na Task 5 (status `cancelled` ignorado).
- **Duplo clique ou retry do cliente no endpoint.** O segundo pedido devolve o estado atual sem outra mensagem na outbox. Testado na Task 8. Duplo envio **concorrente** (os dois pedidos leem `queued` ao mesmo tempo) publica um único webhook `nfse.invoice.cancelled`. Testado na Task 12.
- **Falha transitória da Sefin seguida de retry do BullMQ.** O provider deve fazer replay do XML assinado guardado, sem assinar outro evento. Testado na Task 6.
- **Nota cancelada continua com XML/PDF disponíveis, mas o e-mail é recusado.** Testado na Task 8.

---

### Task 1: Domínio — status, motivo e regras de cancelamento

**Files:**
- Modify: `api/src/modules/invoice/domain/invoice-status.ts`
- Create: `api/src/modules/invoice/domain/cancellation-reason.ts`
- Modify: `api/src/modules/invoice/domain/errors.ts`
- Modify: `api/src/modules/invoice/domain/invoice.ts`
- Modify: `api/src/modules/invoice/domain/invoice-state.ts`
- Modify: `api/src/shared/http/api-error.ts` (mapa `DOMAIN_ERRORS`)
- Test: `api/src/modules/invoice/domain/invoice-cancellation.spec.ts` (novo)
- Test: `api/src/modules/invoice/domain/invoice-state.spec.ts`

**Interfaces:**
- Produces:
  - `type InvoiceStatus` com `'cancelling' | 'cancelled'`. `INVOICE_STATUSES: readonly InvoiceStatus[]`.
  - `CANCELLATION_REASON_CODES`, `type CancellationReasonCode`, `interface CancellationReason { code; description: string | null }`, `cancellationReason(code, description?)`, `assertFiscalCancellationReason(reason)`.
  - Erros `InvoiceNotCancellableError(status)`, `InvalidCancellationReasonError()`, `ConcurrentInvoiceTransitionError(invoiceId)`.
  - `Invoice.requestCancellation(reason): InvoiceEvent`, `Invoice.confirmCancellation(): InvoiceEvent`, `Invoice.rejectCancellation(code, message): InvoiceEvent`, getters `cancellationReason`, `cancelledAt`, `wasAuthorized`.
  - `InvoiceProps` com os campos opcionais `cancellationReason?`, `cancellationDescription?`, `cancelledAt?`.
  - `InvoiceStage` com `'cancelled'`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `api/src/modules/invoice/domain/invoice-cancellation.spec.ts`:

```ts
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from './invoice';
import { cancellationReason } from './cancellation-reason';
import {
  InvalidCancellationReasonError,
  InvalidInvoiceTransitionError,
  InvoiceNotCancellableError,
} from './errors';
import type { InvoiceStatus } from './invoice-status';

const fiscalReason = cancellationReason(
  'issue_error',
  'Valor do serviço informado incorretamente',
);

function invoiceIn(status: InvoiceStatus): Invoice {
  const created = Invoice.create(
    {
      companyId: 'company-1',
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    'tenant-1',
  );
  return Invoice.reconstitute({
    ...created.toSnapshot(),
    status,
    authorizedAt: ['authorized', 'cancelling', 'cancelled'].includes(status)
      ? new Date('2026-10-14T12:00:00Z')
      : null,
  });
}

describe('Invoice cancellation', () => {
  it('cancels a queued invoice locally without requiring a description', () => {
    const invoice = invoiceIn('queued');
    const event = invoice.requestCancellation(cancellationReason('other'));
    expect(invoice.status).toBe('cancelled');
    expect(event.fromStatus).toBe('queued');
    expect(event.toStatus).toBe('cancelled');
    expect(invoice.cancelledAt).toEqual(event.createdAt);
    expect(invoice.cancellationReason).toEqual({
      code: 'other',
      description: null,
    });
  });

  it('moves an authorized invoice to cancelling and records the reason', () => {
    const invoice = invoiceIn('authorized');
    const event = invoice.requestCancellation(fiscalReason);
    expect(invoice.status).toBe('cancelling');
    expect(event.toStatus).toBe('cancelling');
    expect(invoice.cancelledAt).toBeNull();
    expect(invoice.cancellationReason).toEqual(fiscalReason);
  });

  it.each([
    ['shorter than 15', 'curto demais'],
    ['longer than 255', 'x'.repeat(256)],
    ['missing', undefined],
  ])(
    'refuses a fiscal cancellation whose description is %s',
    (_label, description) => {
      const invoice = invoiceIn('authorized');
      expect(() =>
        invoice.requestCancellation(cancellationReason('other', description)),
      ).toThrow(InvalidCancellationReasonError);
      expect(invoice.status).toBe('authorized');
      expect(invoice.cancellationReason).toBeNull();
    },
  );

  it.each([
    'processing',
    'retry_pending',
    'reconciliation_required',
    'manual_review',
    'rejected',
    'failed',
    'cancelling',
    'cancelled',
  ] as const)('refuses to cancel a %s invoice', (status) => {
    expect(() =>
      invoiceIn(status).requestCancellation(fiscalReason),
    ).toThrow(InvoiceNotCancellableError);
  });

  it('confirms a pending cancellation', () => {
    const invoice = invoiceIn('authorized');
    invoice.requestCancellation(fiscalReason);
    const event = invoice.confirmCancellation();
    expect(invoice.status).toBe('cancelled');
    expect(event.fromStatus).toBe('cancelling');
    expect(invoice.cancelledAt).toEqual(event.createdAt);
  });

  it('returns to authorized with the Sefin error when the cancellation is rejected', () => {
    const invoice = invoiceIn('authorized');
    invoice.requestCancellation(fiscalReason);
    const event = invoice.rejectCancellation('E0840', 'Prazo expirado');
    expect(invoice.status).toBe('authorized');
    expect(event.toStatus).toBe('authorized');
    expect(invoice.toSnapshot().lastErrorCode).toBe('E0840');
    expect(invoice.toSnapshot().lastErrorMessage).toBe('Prazo expirado');
  });

  it('cannot confirm a cancellation that was never requested', () => {
    expect(() => invoiceIn('queued').confirmCancellation()).toThrow(
      InvalidInvoiceTransitionError,
    );
  });

  it('trims the description and treats blank text as absent', () => {
    expect(cancellationReason('other', '   ')).toEqual({
      code: 'other',
      description: null,
    });
    expect(cancellationReason('other', '  texto  ').description).toBe('texto');
  });

  it('reports wasAuthorized only after authorization', () => {
    expect(invoiceIn('queued').wasAuthorized).toBe(false);
    expect(invoiceIn('cancelled').wasAuthorized).toBe(true);
  });
});
```

Em `api/src/modules/invoice/domain/invoice-state.spec.ts`, acrescentar dentro do `describe('buildInvoiceState')`:

```ts
  it('is cancelled when the invoice was cancelled', () => {
    expect(buildInvoiceState({ ...base, status: 'cancelled' }).stage).toBe(
      'cancelled',
    );
  });

  it('keeps the authorized view while a cancellation is pending', () => {
    expect(
      buildInvoiceState({ ...base, status: 'cancelling', documentsReady: true })
        .stage,
    ).toBe('completed');
    expect(buildInvoiceState({ ...base, status: 'cancelling' }).stage).toBe(
      'authorized',
    );
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/invoice/domain/invoice-cancellation.spec.ts src/modules/invoice/domain/invoice-state.spec.ts`
Expected: FAIL (`Cannot find module './cancellation-reason'` e erros de tipo para `'cancelled'`).

- [ ] **Step 3: Implementar status e transições**

Substituir `api/src/modules/invoice/domain/invoice-status.ts` por:

```ts
export type InvoiceStatus =
  | 'queued'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'retry_pending'
  | 'reconciliation_required'
  | 'manual_review'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'queued',
  'processing',
  'authorized',
  'rejected',
  'retry_pending',
  'reconciliation_required',
  'manual_review',
  'failed',
  'cancelling',
  'cancelled',
];

export const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  queued: ['processing', 'cancelled'],
  processing: [
    'authorized',
    'rejected',
    'retry_pending',
    'reconciliation_required',
    'failed',
  ],
  retry_pending: ['processing'],
  reconciliation_required: ['authorized', 'rejected', 'manual_review'],
  authorized: ['cancelling'],
  cancelling: ['cancelled', 'authorized'],
  rejected: [],
  manual_review: [],
  failed: [],
  cancelled: [],
};
```

- [ ] **Step 4: Implementar erros e motivo**

Acrescentar ao final de `api/src/modules/invoice/domain/errors.ts`:

```ts
export class InvoiceNotCancellableError extends Error {
  constructor(status: InvoiceStatus) {
    super(`Invoice in status '${status}' cannot be cancelled`);
    this.name = 'InvoiceNotCancellableError';
  }
}

export class InvalidCancellationReasonError extends Error {
  constructor() {
    super('Cancellation description must have 15 to 255 characters');
    this.name = 'InvalidCancellationReasonError';
  }
}

/** Another writer changed the invoice status between load and commit. */
export class ConcurrentInvoiceTransitionError extends Error {
  constructor(readonly invoiceId: string) {
    super('Concurrent invoice transition');
    this.name = 'ConcurrentInvoiceTransitionError';
  }
}
```

Criar `api/src/modules/invoice/domain/cancellation-reason.ts`:

```ts
import { InvalidCancellationReasonError } from './errors';

export const CANCELLATION_REASON_CODES = [
  'issue_error',
  'service_not_provided',
  'other',
] as const;
export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];

export interface CancellationReason {
  code: CancellationReasonCode;
  description: string | null;
}

export function cancellationReason(
  code: CancellationReasonCode,
  description?: string | null,
): CancellationReason {
  const trimmed = description?.trim();
  return { code, description: trimmed ? trimmed : null };
}

/** Sefin TSMotivo (event 101101 xMotivo): 15 to 255 characters. */
export function assertFiscalCancellationReason(
  reason: CancellationReason,
): void {
  const length = reason.description?.length ?? 0;
  if (length < 15 || length > 255) throw new InvalidCancellationReasonError();
}
```

- [ ] **Step 5: Implementar o agregado**

Em `api/src/modules/invoice/domain/invoice.ts`:

1. Imports:

```ts
import {
  InvalidInvoiceTransitionError,
  InvoiceNotCancellableError,
} from './errors';
import {
  assertFiscalCancellationReason,
  type CancellationReason,
  type CancellationReasonCode,
} from './cancellation-reason';
```

(substitui o import atual de `InvalidInvoiceTransitionError`).

2. Em `InvoiceProps`, depois de `lastEmailSentAt: Date | null;`:

```ts
  cancellationReason?: CancellationReasonCode | null;
  cancellationDescription?: string | null;
  cancelledAt?: Date | null;
```

3. Em `Invoice.create`, depois de `lastEmailSentAt: null,`:

```ts
      cancellationReason: null,
      cancellationDescription: null,
      cancelledAt: null,
```

4. Getters (perto de `get amount()`):

```ts
  get cancellationReason(): CancellationReason | null {
    const code = this.props.cancellationReason;
    return code
      ? { code, description: this.props.cancellationDescription ?? null }
      : null;
  }

  get cancelledAt(): Date | null {
    return this.props.cancelledAt ?? null;
  }

  /** True once the Sefin authorized it, even if later cancelled: documents exist. */
  get wasAuthorized(): boolean {
    return this.props.authorizedAt !== null;
  }
```

5. Métodos (depois de `setProcessing()`):

```ts
  /** queued → cancelled (local) or authorized → cancelling (fiscal event). */
  requestCancellation(reason: CancellationReason): InvoiceEvent {
    if (this.props.status === 'queued') {
      this.recordCancellationReason(reason);
      const event = this.transitionTo('cancelled', 'Cancelled before emission');
      this.props.cancelledAt = event.createdAt;
      return event;
    }
    if (this.props.status === 'authorized') {
      assertFiscalCancellationReason(reason);
      this.recordCancellationReason(reason);
      return this.transitionTo('cancelling', 'Cancellation requested');
    }
    throw new InvoiceNotCancellableError(this.props.status);
  }

  confirmCancellation(): InvoiceEvent {
    if (this.props.status !== 'cancelling')
      throw new InvalidInvoiceTransitionError(this.props.status, 'cancelled');
    const event = this.transitionTo('cancelled', 'NFS-e cancelled');
    this.props.cancelledAt = event.createdAt;
    return event;
  }

  rejectCancellation(errorCode: string, errorMessage: string): InvoiceEvent {
    if (this.props.status !== 'cancelling')
      throw new InvalidInvoiceTransitionError(this.props.status, 'authorized');
    this.setRejected(errorCode, errorMessage);
    return this.transitionTo(
      'authorized',
      `Cancellation rejected: ${errorMessage}`,
    );
  }

  private recordCancellationReason(reason: CancellationReason): void {
    this.props.cancellationReason = reason.code;
    this.props.cancellationDescription = reason.description;
  }
```

- [ ] **Step 6: Stage derivado**

Em `api/src/modules/invoice/domain/invoice-state.ts`, acrescentar `| 'cancelled'` ao tipo `InvoiceStage` e trocar `resolveStage` por:

```ts
function resolveStage(input: InvoiceStateInput): InvoiceStage {
  if (input.status === 'cancelled') return 'cancelled';
  if (input.status === 'rejected' || input.status === 'failed') return 'failed';
  // A pending cancellation is still a valid NFS-e with its documents.
  const fiscal = input.status === 'cancelling' ? 'authorized' : input.status;
  if (fiscal !== 'authorized') return 'pending';
  if (!input.documentsReady) return 'authorized';
  const emailResolved =
    !input.emailRequested ||
    input.emailStatus === 'sent' ||
    input.emailStatus === 'failed';
  return emailResolved ? 'completed' : 'documents_ready';
}
```

- [ ] **Step 7: Mapear os erros para HTTP**

Em `api/src/shared/http/api-error.ts`, no objeto `DOMAIN_ERRORS`, depois de `IdempotencyConflictError`:

```ts
  InvoiceNotCancellableError: {
    status: 409,
    code: 'ERROR_INVOICE_NOT_CANCELLABLE',
    message: 'Invoice cannot be cancelled in its current status',
  },
  ConcurrentInvoiceTransitionError: {
    status: 409,
    code: 'ERROR_CONCURRENT_INVOICE_TRANSITION',
    message: 'Invoice changed while the request was processed; retry',
  },
  InvalidCancellationReasonError: {
    status: 422,
    code: 'ERROR_INVALID_CANCELLATION_REASON',
    message: 'Cancellation description must have 15 to 255 characters',
  },
```

- [ ] **Step 8: Rodar e ver passar**

Run: `yarn jest src/modules/invoice/domain src/shared/http`
Expected: PASS (inclusive `invoice.spec.ts`, `invoice-state.spec.ts` e `http-contract.spec.ts`, que já existiam).

- [ ] **Step 9: Commit**

```bash
git add api/src/modules/invoice/domain api/src/shared/http/api-error.ts
git commit -m "feat(invoice): model invoice cancellation in the domain"
```

---

### Task 2: Persistência — migration, entidade, mapper, contrato de leitura

**Files:**
- Create: `api/src/infra/database/migrations/1792400000000-AddInvoiceCancellation.ts`
- Modify: `api/src/modules/invoice/infra/invoice.orm-entity.ts`
- Modify: `api/src/modules/invoice/infra/invoice.mapper.ts`
- Modify: `api/src/modules/invoice/domain/invoice.repository.ts`
- Modify: `api/src/modules/invoice/infra/typeorm-invoice.repository.ts`
- Modify: `api/src/modules/invoice/http/invoice.dto.ts` (`ListInvoicesQuery`)
- Modify: `api/src/modules/invoice/http/invoice-response.dto.ts`
- Test: `api/src/modules/invoice/infra/invoice.mapper.spec.ts` (novo)
- Test: `api/src/modules/invoice/infra/typeorm-invoice.repository.spec.ts`

**Interfaces:**
- Consumes: `InvoiceProps.cancellation*`, `INVOICE_STATUSES`, `CANCELLATION_REASON_CODES` (Task 1).
- Produces: `IInvoiceRepository.saveDpsInfo(invoice: Invoice): Promise<void>`, que atualiza só `dps_id`, `dps_series` e `dps_number`.

- [ ] **Step 1: Testes que falham**

Criar `api/src/modules/invoice/infra/invoice.mapper.spec.ts`:

```ts
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { InvoiceMapper } from './invoice.mapper';

describe('InvoiceMapper cancellation fields', () => {
  it('round-trips the cancellation reason, description and timestamp', () => {
    const invoice = Invoice.create(
      {
        companyId: 'company-1',
        customer: { taxId: VALID_CNPJ, name: 'Cliente' },
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2026-10-14'),
      },
      'tenant-1',
    );
    invoice.requestCancellation(cancellationReason('other', 'Cliente desistiu'));
    const mapper = new InvoiceMapper();
    const orm = mapper.toPersistence(invoice);
    expect(orm.status).toBe('cancelled');
    expect(orm.cancellationReason).toBe('other');
    expect(orm.cancellationDescription).toBe('Cliente desistiu');
    expect(orm.cancelledAt).toEqual(invoice.cancelledAt);

    const back = mapper.toDomain(orm);
    expect(back.cancellationReason).toEqual({
      code: 'other',
      description: 'Cliente desistiu',
    });
    expect(back.cancelledAt).toEqual(invoice.cancelledAt);
  });

  it('maps absent cancellation columns to null', () => {
    const orm = new InvoiceMapper().toPersistence(
      Invoice.create(
        {
          companyId: 'company-1',
          customer: { taxId: VALID_CNPJ, name: 'Cliente' },
          service: {
            description: 'Serviço',
            code: '010101',
            municipalityCode: '3550308',
          },
          amount: 100,
          competenceDate: new Date('2026-10-14'),
        },
        'tenant-1',
      ),
    );
    orm.cancellationReason = undefined;
    orm.cancelledAt = undefined;
    const back = new InvoiceMapper().toDomain(orm);
    expect(back.cancellationReason).toBeNull();
    expect(back.cancelledAt).toBeNull();
  });
});
```

Em `api/src/modules/invoice/infra/typeorm-invoice.repository.spec.ts`, acrescentar ao `describe('TypeOrmInvoiceRepository')`:

```ts
  describe('saveDpsInfo', () => {
    it('updates only the DPS columns so a concurrent status change survives', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb as any);
      const invoice = {
        toSnapshot: () => ({
          id: 'inv-1',
          tenantId,
          dpsId: 'dps-uuid',
          dpsSeries: '1',
          dpsNumber: 7,
        }),
      } as any;

      await repository.saveDpsInfo(invoice);

      expect(qb.set).toHaveBeenCalledWith({
        dpsId: 'dps-uuid',
        dpsSeries: '1',
        dpsNumber: 7,
      });
      expect(qb.where).toHaveBeenCalledWith(
        'id = :id AND tenant_id = :tenantId',
        { id: 'inv-1', tenantId },
      );
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/invoice/infra/invoice.mapper.spec.ts src/modules/invoice/infra/typeorm-invoice.repository.spec.ts`
Expected: FAIL (`cancellationReason` inexistente em `InvoiceOrmEntity`, `saveDpsInfo is not a function`).

- [ ] **Step 3: Migration**

Criar `api/src/infra/database/migrations/1792400000000-AddInvoiceCancellation.ts`:

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

const PREVIOUS_STATUSES = `'queued', 'processing', 'authorized', 'rejected', 'retry_pending', 'reconciliation_required', 'manual_review', 'failed'`;
const STATUSES = `${PREVIOUS_STATUSES}, 'cancelling', 'cancelled'`;

export class AddInvoiceCancellation1792400000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices DROP CONSTRAINT ck_nfse_invoices_status`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD CONSTRAINT ck_nfse_invoices_status CHECK ("status" IN (${STATUSES}))`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices
         ADD COLUMN cancellation_reason varchar(30),
         ADD COLUMN cancellation_description text,
         ADD COLUMN cancelled_at timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices
         DROP COLUMN cancelled_at,
         DROP COLUMN cancellation_description,
         DROP COLUMN cancellation_reason`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices DROP CONSTRAINT ck_nfse_invoices_status`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD CONSTRAINT ck_nfse_invoices_status CHECK ("status" IN (${PREVIOUS_STATUSES}))`,
    );
  }
}
```

Se `down` for rodado com linhas canceladas no banco, a recriação do CHECK falha. Isso é intencional: não há como voltar sem decidir o destino dessas notas.

- [ ] **Step 4: Entidade e mapper**

Em `api/src/modules/invoice/infra/invoice.orm-entity.ts`, trocar o `@Check('ck_nfse_invoices_status', ...)` por:

```ts
@Check(
  'ck_nfse_invoices_status',
  `"status" IN ('queued', 'processing', 'authorized', 'rejected', 'retry_pending', 'reconciliation_required', 'manual_review', 'failed', 'cancelling', 'cancelled')`,
)
```

e acrescentar antes de `@CreateDateColumn`:

```ts
  @Column({
    name: 'cancellation_reason',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  cancellationReason?: string | null;

  @Column({ name: 'cancellation_description', type: 'text', nullable: true })
  cancellationDescription?: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;
```

Em `api/src/modules/invoice/infra/invoice.mapper.ts`:
- Importar `import type { CancellationReasonCode } from '../domain/cancellation-reason';`.
- Em `toDomain`, depois de `lastEmailSentAt: ...`:

```ts
      cancellationReason:
        (orm.cancellationReason as CancellationReasonCode | null) ?? null,
      cancellationDescription: orm.cancellationDescription ?? null,
      cancelledAt: orm.cancelledAt ?? null,
```

- Em `toPersistence`, depois de `orm.lastEmailSentAt = ...`:

```ts
    orm.cancellationReason = snapshot.cancellationReason ?? null;
    orm.cancellationDescription = snapshot.cancellationDescription ?? null;
    orm.cancelledAt = snapshot.cancelledAt ?? null;
```

- [ ] **Step 5: `saveDpsInfo`**

Em `api/src/modules/invoice/domain/invoice.repository.ts`, dentro de `IInvoiceRepository`, depois de `save(...)`:

```ts
  /** Persists only the DPS identity; never overwrites status or other fields. */
  saveDpsInfo(invoice: Invoice): Promise<void>;
```

Em `api/src/modules/invoice/infra/typeorm-invoice.repository.ts`, depois de `save(...)`:

```ts
  async saveDpsInfo(invoice: Invoice): Promise<void> {
    const snapshot = invoice.toSnapshot();
    return runWithTenant(snapshot.tenantId, async () => {
      requireTenantId(snapshot.tenantId);
      await this.repo
        .createQueryBuilder()
        .update()
        .set({
          dpsId: snapshot.dpsId ?? undefined,
          dpsSeries: snapshot.dpsSeries ?? undefined,
          dpsNumber: snapshot.dpsNumber ?? undefined,
        })
        .where('id = :id AND tenant_id = :tenantId', {
          id: snapshot.id,
          tenantId: snapshot.tenantId,
        })
        .execute();
    });
  }
```

- [ ] **Step 6: Contrato de leitura**

Em `api/src/modules/invoice/http/invoice.dto.ts`, importar `INVOICE_STATUSES` de `'../domain/invoice-status'` e trocar o `@IsIn([...] as InvoiceStatus[])` de `ListInvoicesQuery.status` por `@IsIn(INVOICE_STATUSES)`.

Em `api/src/modules/invoice/http/invoice-response.dto.ts`, importar `CANCELLATION_REASON_CODES` e `type CancellationReasonCode` de `'../domain/cancellation-reason'` e acrescentar em `InvoiceResponseDto`, depois de `lastEmail`:

```ts
  @ApiPropertyOptional({ enum: CANCELLATION_REASON_CODES, nullable: true })
  cancellationReason?: CancellationReasonCode | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  cancellationDescription?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  cancelledAt?: Date | null;
```

- [ ] **Step 7: Rodar e ver passar**

Run: `yarn jest src/modules/invoice src/infra/openapi`
Expected: PASS.

Run: `grep -rn "ck_nfse_invoices_status\|'manual_review', 'failed')" src --include='*.spec.ts'`
Se algum spec fixa o texto antigo do CHECK, atualizar para incluir `'cancelling', 'cancelled'`.

Se `MIGRATION_TEST_DATABASE_URL` estiver configurada: `yarn jest src/infra/database/migrations/baseline.postgres.integration.spec.ts`. Expected: PASS (entidade e migration batem). Sem a variável, o spec é pulado; registre isso no resumo da tarefa.

- [ ] **Step 8: Commit**

```bash
git add api/src/infra/database/migrations/1792400000000-AddInvoiceCancellation.ts api/src/modules/invoice/infra api/src/modules/invoice/domain/invoice.repository.ts api/src/modules/invoice/http
git commit -m "feat(invoice): persist cancellation status and fields"
```

---

### Task 3: Lifecycle — erro tipado, outbox na transição e créditos

**Files:**
- Modify: `api/src/modules/invoice/application/invoice-lifecycle.service.ts`
- Modify: `api/src/modules/billing/application/billing-usage.service.ts`
- Test: `api/src/modules/invoice/application/invoice-lifecycle.transition.spec.ts` (novo)

**Interfaces:**
- Consumes: `ConcurrentInvoiceTransitionError` (Task 1), `NewOutboxMessage` (`../domain/outbox-message`).
- Produces: `InvoiceLifecycleService.transition(invoice: Invoice, event: InvoiceEvent, message?: NewOutboxMessage): Promise<void>`. Lança `ConcurrentInvoiceTransitionError` quando o status gravado difere do `fromStatus`.

- [ ] **Step 1: Testes que falham**

Criar `api/src/modules/invoice/application/invoice-lifecycle.transition.spec.ts`:

```ts
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import type { NewOutboxMessage } from '../domain/outbox-message';
import { CreditTransactionOrmEntity } from '@/modules/credits/infra/credit-transaction.orm-entity';
import { InvoiceOrmEntity } from '../infra/invoice.orm-entity';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function invoiceIn(status: InvoiceStatus, environment: 'test' | 'live') {
  const created = Invoice.create(
    {
      companyId: '22222222-2222-4222-8222-222222222222',
      environment,
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    tenantId,
  );
  return Invoice.reconstitute({
    ...created.toSnapshot(),
    status,
    authorizedAt: status === 'authorized' ? new Date() : null,
  });
}

function build(
  storedStatus: InvoiceStatus,
  reservation: { id: string; amount: number } | null,
) {
  const order: string[] = [];
  const persisted: Record<string, unknown>[] = [];
  const walletInserts: Record<string, unknown>[] = [];
  const walletUpdates: unknown[][] = [];
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: (entity: unknown) => ({
      findOneByOrFail: jest.fn().mockResolvedValue({ status: storedStatus }),
      findOneBy: jest.fn().mockResolvedValue(reservation),
      createQueryBuilder: () => {
        const qb = {
          update: () => qb,
          set: (values: Record<string, unknown>) => {
            if (entity === InvoiceOrmEntity) persisted.push(values);
            return qb;
          },
          where: () => qb,
          execute: async () => ({ affected: 1 }),
        };
        return qb;
      },
      insert: jest.fn(async (value: Record<string, unknown>) => {
        if (entity === CreditTransactionOrmEntity) walletInserts.push(value);
        else order.push('event');
      }),
      update: jest.fn(async (...args: unknown[]) => {
        walletUpdates.push(args);
      }),
    }),
  };
  const database = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<void>) =>
      work(manager),
    ),
  };
  const usage = { reserve: jest.fn(), settle: jest.fn() };
  const outbox = {
    enqueue: jest.fn(async () => {
      order.push('outbox');
      return true;
    }),
  };
  const service = new InvoiceLifecycleService(
    database as never,
    { delete: jest.fn() } as never,
    usage as never,
    new TypeOrmTransactionContext(),
    outbox as never,
  );
  return { service, usage, outbox, order, persisted, walletInserts, walletUpdates };
}

const message: NewOutboxMessage = {
  tenantId,
  environment: 'live',
  type: 'invoice.cancel',
  aggregateId: 'inv',
  payload: {},
  dedupeKey: 'cancellation:evt',
};

describe('InvoiceLifecycleService.transition — cancellation', () => {
  it('refunds the live reservation and settles usage when a queued invoice is cancelled', async () => {
    const ctx = build('queued', { id: 'res-1', amount: -1 });
    const invoice = invoiceIn('queued', 'live');
    await ctx.service.transition(
      invoice,
      invoice.requestCancellation(cancellationReason('other')),
    );
    expect(ctx.usage.settle).toHaveBeenCalledWith(
      invoice.id,
      tenantId,
      'cancelled',
    );
    expect(ctx.walletInserts).toEqual([
      expect.objectContaining({ amount: 1, type: 'invoice_rejected' }),
    ]);
    expect(ctx.walletUpdates[0][1]).toEqual({ isReservation: false });
    expect(ctx.persisted[0]).toMatchObject({ pendingEmission: null });
  });

  it('enqueues the outbox message after the event, in the same transaction', async () => {
    const ctx = build('authorized', null);
    const invoice = invoiceIn('authorized', 'live');
    const event = invoice.requestCancellation(
      cancellationReason('issue_error', 'Valor informado incorretamente'),
    );
    await ctx.service.transition(invoice, event, message);
    expect(ctx.order).toEqual(['event', 'outbox']);
    expect(ctx.outbox.enqueue).toHaveBeenCalledWith(message);
    expect(ctx.walletInserts).toEqual([]);
  });

  it('keeps the pending fiscal event while cancelling', async () => {
    const ctx = build('authorized', null);
    const invoice = invoiceIn('authorized', 'test');
    await ctx.service.transition(
      invoice,
      invoice.requestCancellation(
        cancellationReason('issue_error', 'Valor informado incorretamente'),
      ),
    );
    expect(ctx.persisted[0]).not.toHaveProperty('pendingEmission');
  });

  it('throws a typed error when another writer changed the status', async () => {
    const ctx = build('processing', null);
    const invoice = invoiceIn('queued', 'test');
    await expect(
      ctx.service.transition(
        invoice,
        invoice.requestCancellation(cancellationReason('other')),
      ),
    ).rejects.toBeInstanceOf(ConcurrentInvoiceTransitionError);
    expect(ctx.outbox.enqueue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/invoice/application/invoice-lifecycle.transition.spec.ts`
Expected: FAIL (erro genérico em vez do tipado, nenhum estorno para `cancelled`, `enqueue` não chamado).

- [ ] **Step 3: Implementar**

Em `api/src/modules/invoice/application/invoice-lifecycle.service.ts`:
- Imports: `import { ConcurrentInvoiceTransitionError } from '../domain/errors';` e `import type { NewOutboxMessage } from '../domain/outbox-message';`.
- No topo do arquivo (fora da classe):

```ts
/** Statuses after which no fiscal retry can still need the signed pending XML. */
const SETTLED_STATUSES = ['authorized', 'rejected', 'failed', 'cancelled'];
/** Statuses that release an unused live reservation. */
const REFUND_STATUSES = ['rejected', 'failed', 'cancelled'];
```

- Trocar a assinatura e o corpo de `transition` por:

```ts
  async transition(
    invoice: Invoice,
    event: InvoiceEvent,
    message?: NewOutboxMessage,
  ): Promise<void> {
    return runWithTenant(invoice.tenantId, async () => {
      await this.database.transaction(async (manager) =>
        this.context.run(manager, async () => {
          if (event.invoiceId !== invoice.id)
            throw new Error('Invoice/event identity mismatch');
          await this.lockTenant(manager, invoice.tenantId);
          const stored = await manager
            .getRepository(InvoiceOrmEntity)
            .findOneByOrFail({
              id: invoice.id,
              tenantId: invoice.tenantId,
              environment: invoice.environment,
            });
          if (stored.status === invoice.status) return;
          if (stored.status !== event.toSnapshot().fromStatus)
            throw new ConcurrentInvoiceTransitionError(invoice.id);
          const record = new InvoiceMapper().toPersistence(invoice);
          if (SETTLED_STATUSES.includes(invoice.status))
            record.pendingEmission = null;
          await persistTenantEntity(
            manager.getRepository(InvoiceOrmEntity),
            record,
            invoice.tenantId,
            ['companyId', 'environment'],
          );
          await manager
            .getRepository(InvoiceEventOrmEntity)
            .insert(new InvoiceEventMapper().toPersistence(event));
          if (message) await this.outbox.enqueue(message);
          if (invoice.environment !== 'live') return;
          await this.usage.settle(invoice.id, invoice.tenantId, invoice.status);
          const wallet = manager.getRepository(CreditTransactionOrmEntity);
          const reservation = await wallet.findOneBy({
            tenantId: invoice.tenantId,
            reservedInvoiceId: invoice.id,
            isReservation: true,
          });
          if (!reservation) return;
          if (invoice.status === 'authorized')
            await wallet.update(
              { id: reservation.id, tenantId: invoice.tenantId },
              { isReservation: false },
            );
          if (REFUND_STATUSES.includes(invoice.status)) {
            await wallet.insert({
              tenantId: invoice.tenantId,
              amount: -reservation.amount,
              type: 'invoice_rejected',
              relatedTransactionId: reservation.id,
              isReservation: false,
              description: `Refund for invoice ${invoice.id}`,
            });
            await wallet.update(
              { id: reservation.id, tenantId: invoice.tenantId },
              { isReservation: false },
            );
          }
        }),
      );
      if (invoice.environment === 'live')
        await this.cache.delete(`credit:balance:${invoice.tenantId}`);
    });
  }
```

Em `api/src/modules/billing/application/billing-usage.service.ts`, no `settle`, trocar a primeira linha por:

```ts
    if (!['authorized', 'rejected', 'failed', 'cancelled'].includes(status))
      return;
```

(`period.settle(status === 'authorized')` continua igual: `cancelled` libera o reservado sem contar como autorizado. Uma nota que foi autorizada e depois cancelada não tem reserva aberta, então `reservedPeriod` devolve `null` e nada muda.)

- [ ] **Step 4: Rodar e ver passar**

Run: `yarn jest src/modules/invoice/application src/modules/billing`
Expected: PASS (inclusive `invoice-lifecycle.service.spec.ts`, que já existia).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/invoice/application/invoice-lifecycle.service.ts api/src/modules/invoice/application/invoice-lifecycle.transition.spec.ts api/src/modules/billing/application/billing-usage.service.ts
git commit -m "feat(invoice): settle credits and enqueue outbox on cancellation transitions"
```

---

### Task 4: `InvoiceWebhookPublisher` e eventos de cancelamento

**Files:**
- Create: `api/src/modules/invoice/application/invoice-webhook.publisher.ts`
- Modify: `api/src/modules/invoice/application/nfse-workflow.service.ts`
- Modify: `api/src/modules/webhooks-config/domain/webhook-event.ts`
- Modify: `api/src/modules/invoice/invoice.module.ts`
- Modify: `api/src/modules/invoice/application/nfse-workflow.service.spec.ts`
- Test: `api/src/modules/invoice/application/invoice-webhook.publisher.spec.ts` (novo)

**Interfaces:**
- Produces: `InvoiceWebhookPublisher.publish(invoice: Invoice, type: WebhookEvent['type'], extra?: Record<string, unknown>, stateOverride?: Partial<Pick<InvoiceState, 'emailStatus'>>): Promise<void>`. Nunca lança (loga a falha). Provider e export do `InvoiceModule`.
- `NfseWorkflowService` passa a receber o publisher no lugar de `IWebhookConfigRepository` e `WebhookOutboxService`. Nova ordem do construtor: `(invoices, sequences, companies, certificates, providers, lifecycle, queues, webhooks: InvoiceWebhookPublisher, documentStorage)`.

- [ ] **Step 1: Teste que falha**

Criar `api/src/modules/invoice/application/invoice-webhook.publisher.spec.ts`:

```ts
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import type { Invoice } from '../domain/invoice';
import { buildInvoiceState } from '../domain/invoice-state';

const invoice = {
  id: 'inv-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  companyId: 'company-1',
  environment: 'live',
  status: 'cancelled',
  documentsReadyAt: new Date(),
  emailSnapshot: { send: false },
  lastEmailStatus: null,
  state: buildInvoiceState({
    status: 'cancelled',
    documentsReady: true,
    emailRequested: false,
    emailStatus: null,
  }),
} as unknown as Invoice;

describe('InvoiceWebhookPublisher', () => {
  it('enqueues one delivery per active subscription with the invoice state', async () => {
    const outbox = { enqueue: jest.fn() };
    const configs = [
      { id: 'cfg-1', active: true, url: 'https://a.test', secret: 's1' },
      { id: 'cfg-2', active: false, url: 'https://b.test', secret: 's2' },
    ];
    const webhooks = {
      findByTenantIdAndEvent: jest.fn().mockResolvedValue(configs),
    };
    const publisher = new InvoiceWebhookPublisher(
      webhooks as never,
      outbox as never,
    );

    await publisher.publish(invoice, 'nfse.invoice.cancelled', {
      reason: 'other',
    });

    expect(webhooks.findByTenantIdAndEvent).toHaveBeenCalledWith(
      invoice.tenantId,
      'nfse.invoice.cancelled',
    );
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue.mock.calls[0][0]).toMatchObject({
      webhookConfigId: 'cfg-1',
      eventType: 'nfse.invoice.cancelled',
      payload: {
        type: 'nfse.invoice.cancelled',
        data: {
          invoiceId: 'inv-1',
          status: 'cancelled',
          stage: 'cancelled',
          reason: 'other',
        },
      },
    });
  });

  it('swallows delivery failures so the fiscal flow is not interrupted', async () => {
    const publisher = new InvoiceWebhookPublisher(
      { findByTenantIdAndEvent: jest.fn().mockRejectedValue(new Error('db')) } as never,
      { enqueue: jest.fn() } as never,
    );
    await expect(
      publisher.publish(invoice, 'nfse.invoice.cancelled'),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/invoice/application/invoice-webhook.publisher.spec.ts`
Expected: FAIL (`Cannot find module './invoice-webhook.publisher'`).

- [ ] **Step 3: Eventos públicos**

Em `api/src/modules/webhooks-config/domain/webhook-event.ts`, acrescentar `| 'nfse.invoice.cancelled'` e `| 'nfse.invoice.cancellation_rejected'` em `WebhookEventType` (depois de `'nfse.invoice.email_failed'`) e os mesmos dois valores no fim de `PUBLIC_WEBHOOK_EVENT_TYPES`.

Run: `grep -rn "nfse.invoice.email_failed" src --include='*.ts'`
Se aparecer outra lista fixa de eventos (DTO, seed ou spec de contrato), acrescentar os dois eventos lá também.

- [ ] **Step 4: Extrair o publisher**

Criar `api/src/modules/invoice/application/invoice-webhook.publisher.ts` com o corpo que hoje está em `NfseWorkflowService.stateOf` + `emitWebhook`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import type { WebhookEvent } from '@/modules/webhooks-config/domain/webhook-event';
import type { Invoice } from '../domain/invoice';
import { buildInvoiceState, type InvoiceState } from '../domain/invoice-state';

/** Best-effort tenant webhooks for invoice lifecycle events. */
@Injectable()
export class InvoiceWebhookPublisher {
  private readonly logger = new Logger(InvoiceWebhookPublisher.name);

  constructor(
    private readonly webhooks: IWebhookConfigRepository,
    private readonly outbox: WebhookOutboxService,
  ) {}

  async publish(
    invoice: Invoice,
    type: WebhookEvent['type'],
    extra: Record<string, unknown> = {},
    stateOverride: Partial<Pick<InvoiceState, 'emailStatus'>> = {},
  ): Promise<void> {
    try {
      const configs = await this.webhooks.findByTenantIdAndEvent(
        invoice.tenantId,
        type,
      );
      const event: WebhookEvent = {
        id: `evt_${crypto.randomUUID()}`,
        type,
        environment: invoice.environment,
        createdAt: new Date().toISOString(),
        data: {
          invoiceId: invoice.id,
          companyId: invoice.companyId,
          environment: invoice.environment,
          ...this.stateOf(invoice, stateOverride),
          ...extra,
        },
      };
      for (const config of configs)
        if (config.active)
          await this.outbox.enqueue({
            tenantId: invoice.tenantId,
            webhookConfigId: config.id,
            eventType: type,
            environment: invoice.environment,
            url: config.url,
            payload: event,
            secret: config.secret,
          });
    } catch (error: unknown) {
      this.logger.error(
        { err: error, invoiceId: invoice.id },
        'Fiscal webhook enqueue failed',
      );
    }
  }

  /** Current fiscal/documents/email state; the event itself may be newer than the loaded invoice. */
  private stateOf(
    invoice: Invoice,
    override: Partial<Pick<InvoiceState, 'emailStatus'>>,
  ): InvoiceState {
    return buildInvoiceState({
      status: invoice.status,
      documentsReady: invoice.documentsReadyAt !== null,
      emailRequested: Boolean(invoice.emailSnapshot?.send),
      emailStatus: override.emailStatus ?? invoice.lastEmailStatus,
    });
  }
}
```

Em `api/src/modules/invoice/application/nfse-workflow.service.ts`:
- Remover os imports de `IWebhookConfigRepository`, `WebhookOutboxService`, `WebhookEvent`, `buildInvoiceState` e `InvoiceState`. Importar `InvoiceWebhookPublisher` de `'./invoice-webhook.publisher'`.
- No construtor, trocar `private readonly webhooks: IWebhookConfigRepository, private readonly outbox: WebhookOutboxService,` por `private readonly webhooks: InvoiceWebhookPublisher,`.
- Apagar os métodos privados `stateOf` e `emitWebhook`.
- Substituir cada `this.emitWebhook(` por `this.webhooks.publish(` (são 5 chamadas: authorized, manual_review, rejected, email_sent, email_failed). Os argumentos não mudam.

Em `api/src/modules/invoice/invoice.module.ts`: importar `InvoiceWebhookPublisher` e acrescentá-lo a `providers` e a `exports`. (`WebhooksConfigModule` já é importado e fornece o repositório e o `WebhookOutboxService`. Se a resolução de DI falhar no Step 5, verificar se ambos estão em `exports` desse módulo e acrescentar o que faltar.)

Em `api/src/modules/invoice/application/nfse-workflow.service.spec.ts`, trocar a construção do serviço por:

```ts
    service = new NfseWorkflowService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new InvoiceWebhookPublisher(webhooks as any, outbox as any),
      {} as any,
    );
```

com `import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';`.

- [ ] **Step 5: Rodar e ver passar**

Run: `yarn jest src/modules/invoice src/modules/webhooks-config src/worker-app.module-composition.spec.ts src/runtime-wiring.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/invoice api/src/modules/webhooks-config/domain/webhook-event.ts
git commit -m "refactor(invoice): extract InvoiceWebhookPublisher and add cancellation events"
```

---

### Task 5: Workflow — uma nota cancelada nunca é emitida

**Files:**
- Modify: `api/src/modules/invoice/application/nfse-workflow.service.ts`
- Test: `api/src/modules/invoice/application/nfse-workflow.cancellation-race.spec.ts` (novo)

**Interfaces:**
- Consumes: `IInvoiceRepository.saveDpsInfo` (Task 2), `ConcurrentInvoiceTransitionError` (Task 1/3), construtor da Task 4.

- [ ] **Step 1: Testes que falham**

Criar `api/src/modules/invoice/application/nfse-workflow.cancellation-race.spec.ts`:

```ts
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import { ConcurrentInvoiceTransitionError } from '../domain/errors';
import { NfseWorkflowService } from './nfse-workflow.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function queuedInvoice(): Invoice {
  return Invoice.create(
    {
      companyId: 'company-1',
      environment: 'test',
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    tenantId,
  );
}

function build(invoice: Invoice, transition: jest.Mock) {
  const invoices = {
    findByIdAndTenantId: jest.fn().mockResolvedValue(invoice),
    save: jest.fn(),
    saveDpsInfo: jest.fn(),
  };
  const provider = { issue: jest.fn() };
  const service = new NfseWorkflowService(
    invoices as any,
    {
      reserveNext: jest.fn().mockResolvedValue({ series: '1', number: 7 }),
    } as any,
    {
      findById: jest.fn().mockResolvedValue({
        id: 'company-1',
        taxId: VALID_CNPJ,
        legalName: 'Empresa',
        municipalityCode: '3550308',
        taxRegime: 'Simples Nacional',
      }),
    } as any,
    {} as any,
    { resolve: () => provider } as any,
    { transition } as any,
    { add: jest.fn() } as any,
    { publish: jest.fn() } as any,
    {} as any,
  );
  return { service, invoices, provider };
}

describe('NfseWorkflowService — cancellation race', () => {
  it('persists only the DPS identity, never the stale status', async () => {
    const invoice = queuedInvoice();
    const transition = jest
      .fn()
      .mockRejectedValue(new ConcurrentInvoiceTransitionError(invoice.id));
    const { service, invoices } = build(invoice, transition);
    await service.process({ invoiceId: invoice.id, tenantId });
    expect(invoices.saveDpsInfo).toHaveBeenCalledWith(invoice);
    expect(invoices.save).not.toHaveBeenCalled();
  });

  it('stops without issuing when the invoice was cancelled concurrently', async () => {
    const invoice = queuedInvoice();
    const transition = jest
      .fn()
      .mockRejectedValue(new ConcurrentInvoiceTransitionError(invoice.id));
    const { service, provider } = build(invoice, transition);
    await expect(
      service.process({ invoiceId: invoice.id, tenantId }),
    ).resolves.toBeUndefined();
    expect(provider.issue).not.toHaveBeenCalled();
  });

  it('ignores a late emission job for an already cancelled invoice', async () => {
    const invoice = queuedInvoice();
    invoice.requestCancellation(cancellationReason('other'));
    const transition = jest.fn();
    const { service, provider, invoices } = build(invoice, transition);
    await service.process({ invoiceId: invoice.id, tenantId });
    expect(transition).not.toHaveBeenCalled();
    expect(invoices.saveDpsInfo).not.toHaveBeenCalled();
    expect(provider.issue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/invoice/application/nfse-workflow.cancellation-race.spec.ts`
Expected: FAIL nos dois primeiros (`save` chamado; o erro de concorrência é propagado). O terceiro já passa (guarda existente); ele fica como teste de regressão.

- [ ] **Step 3: Implementar**

Em `api/src/modules/invoice/application/nfse-workflow.service.ts`:
- Importar `import { ConcurrentInvoiceTransitionError } from '../domain/errors';`.
- Em `payload()`, trocar `await this.invoices.save(invoice, invoice.tenantId);` por `await this.invoices.saveDpsInfo(invoice);`.
- Em `processTenant`, trocar o bloco `if (invoice.status === 'queued') { ... }` por:

```ts
    if (invoice.status === 'queued') {
      const event = invoice.transitionTo(
        'processing',
        'Starting fiscal emission',
      );
      try {
        await this.lifecycle.transition(invoice, event);
      } catch (error: unknown) {
        // Cancelled (or taken by another worker) after we loaded it: never issue.
        if (error instanceof ConcurrentInvoiceTransitionError) return;
        throw error;
      }
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `yarn jest src/modules/invoice`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/invoice/application/nfse-workflow.service.ts api/src/modules/invoice/application/nfse-workflow.cancellation-race.spec.ts
git commit -m "fix(invoice): never issue an invoice cancelled while the worker loads it"
```

---

### Task 6: Provider fiscal — `cancel()`

**Files:**
- Modify: `api/src/infra/external/nfse/nfse-fiscal-provider.ts`
- Modify: `api/src/infra/external/nfse/open-nfse.provider.ts`
- Modify: `api/src/infra/external/nfse/fake-nfse.provider.ts`
- Modify: `api/test/__mocks__/open-nfse.ts`
- Test: `api/src/infra/external/nfse/open-nfse.provider.cancel.spec.ts` (novo)
- Test: `api/src/infra/external/nfse/fake-nfse.provider.spec.ts`

**Interfaces:**
- Produces:

```ts
export type FiscalCancellationReason = 'issue_error' | 'service_not_provided' | 'other';
export interface ICancelPayload {
  invoiceId: string;
  tenantId: string;
  accessKey: string;
  environment: 'test' | 'live';
  pfxBuffer: Buffer;
  p12Password: string;
  emitenteCnpj: string;
  reason: FiscalCancellationReason;
  description: string;
}
export type FiscalCancelResult =
  | { status: 'cancelled' }
  | { status: 'rejected'; errorCode: string; errorMessage: string }
  | { status: 'pending'; errorMessage: string };
// FiscalProvider ganha: cancel(payload: ICancelPayload): Promise<FiscalCancelResult>;
```

- [ ] **Step 1: Ajustar o mock do `open-nfse`**

Em `api/test/__mocks__/open-nfse.ts`:
- Na classe `ReceitaRejectionError`, acrescentar o getter `get codigo(): string { return this.code ?? ''; }`.
- Na classe `NfseClient`, acrescentar:

```ts
  // eslint-disable-next-line @typescript-eslint/require-await
  async cancelar(_params: any): Promise<any> {
    return { status: 'ok', evento: {} };
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async replayPendingEvents(_store?: any): Promise<any[]> {
    return [];
  }
  async close(): Promise<void> {}
```

- No fim do arquivo, junto das reexportações do sdk: `export const JustificativaCancelamento = sdk.JustificativaCancelamento;`.

- [ ] **Step 2: Testes que falham**

Criar `api/src/infra/external/nfse/open-nfse.provider.cancel.spec.ts`:

```ts
import {
  NfseClient,
  ReceitaRejectionError,
  type PendingEvent,
  type RetryStore,
} from 'open-nfse';
import { OpenNfseProvider } from './open-nfse.provider';
import type { ICancelPayload } from './nfse-fiscal-provider';

const payload: ICancelPayload = {
  invoiceId: 'inv-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  accessKey: '3'.repeat(50),
  environment: 'live',
  pfxBuffer: Buffer.from('pfx'),
  p12Password: 'secret',
  emitenteCnpj: '11222333000181',
  reason: 'service_not_provided',
  description: 'Serviço não foi prestado ao cliente',
};

function providerWith(pending: PendingEvent[] = []) {
  const store: RetryStore = {
    save: jest.fn(),
    list: jest.fn().mockResolvedValue(pending),
    delete: jest.fn(),
  };
  const provider = new OpenNfseProvider({} as never);
  jest.spyOn(provider as any, 'store').mockReturnValue(store);
  return { provider, store };
}

afterEach(() => jest.restoreAllMocks());

describe('OpenNfseProvider.cancel', () => {
  it('sends event 101101 with the mapped reason and the retry store', async () => {
    const cancelar = jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      .mockResolvedValue({ status: 'ok', evento: {} });
    const { provider, store } = providerWith();
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(cancelar).toHaveBeenCalledWith({
      chaveAcesso: payload.accessKey,
      autor: { CNPJ: payload.emitenteCnpj },
      cMotivo: '2',
      xMotivo: payload.description,
      retryStore: store,
    });
  });

  it('reports pending when the Sefin call fails transiently', async () => {
    jest.spyOn(NfseClient.prototype as any, 'cancelar').mockResolvedValue({
      status: 'retry_pending',
      pending: {},
      error: new Error('timeout'),
    });
    const { provider } = providerWith();
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'pending',
      errorMessage: 'timeout',
    });
  });

  it('replays the stored signed event instead of signing a new one', async () => {
    const cancelar = jest.spyOn(NfseClient.prototype as any, 'cancelar');
    const replay = jest
      .spyOn(NfseClient.prototype as any, 'replayPendingEvents')
      .mockResolvedValue([{ id: 'p1', status: 'success', evento: {} }]);
    const { provider, store } = providerWith([
      { kind: 'cancelamento_simples' } as PendingEvent,
    ]);
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(replay).toHaveBeenCalledWith(store);
    expect(cancelar).not.toHaveBeenCalled();
  });

  it('maps a permanent Sefin rejection to rejected', async () => {
    jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      .mockRejectedValue(new ReceitaRejectionError('Prazo expirado', 'E0840'));
    const { provider } = providerWith();
    await expect(provider.cancel(payload)).resolves.toEqual({
      status: 'rejected',
      errorCode: 'E0840',
      errorMessage: 'Prazo expirado',
    });
  });

  it('rethrows unexpected errors so the job retries', async () => {
    jest
      .spyOn(NfseClient.prototype as any, 'cancelar')
      .mockRejectedValue(new Error('certificate unreadable'));
    const { provider } = providerWith();
    await expect(provider.cancel(payload)).rejects.toThrow(
      'certificate unreadable',
    );
  });
});
```

Em `api/src/infra/external/nfse/fake-nfse.provider.spec.ts`, acrescentar:

```ts
describe('FakeNfseProvider.cancel', () => {
  const base = {
    invoiceId: 'inv-1',
    tenantId: 't-1',
    accessKey: '1'.repeat(50),
    pfxBuffer: Buffer.alloc(0),
    p12Password: '',
    emitenteCnpj: '11222333000181',
    reason: 'other' as const,
    description: 'Cancelamento de teste simulado',
  };

  it('simulates an accepted cancellation in test', async () => {
    await expect(
      new FakeNfseProvider().cancel({ ...base, environment: 'test' }),
    ).resolves.toEqual({ status: 'cancelled' });
  });

  it('refuses live', async () => {
    await expect(
      new FakeNfseProvider().cancel({ ...base, environment: 'live' }),
    ).rejects.toThrow('only in test');
  });
});
```

(Se o spec existente ainda não importar `FakeNfseProvider` no topo, acrescentar `import { FakeNfseProvider } from './fake-nfse.provider';`.)

- [ ] **Step 3: Rodar e ver falhar**

Run: `yarn jest src/infra/external/nfse`
Expected: FAIL (`provider.cancel is not a function`).

- [ ] **Step 4: Implementar a porta**

Em `api/src/infra/external/nfse/nfse-fiscal-provider.ts`, acrescentar os tipos de **Interfaces → Produces** acima e o método `cancel(payload: ICancelPayload): Promise<FiscalCancelResult>;` em `FiscalProvider`.

- [ ] **Step 5: Implementar o `OpenNfseProvider`**

Em `api/src/infra/external/nfse/open-nfse.provider.ts`:
- Acrescentar `JustificativaCancelamento` ao import de `'open-nfse'` e `ICancelPayload`, `FiscalCancelResult` e `FiscalCancellationReason` ao import de `'./nfse-fiscal-provider'`.
- Antes da classe:

```ts
const CANCELLATION_REASON: Record<
  FiscalCancellationReason,
  JustificativaCancelamento
> = {
  issue_error: JustificativaCancelamento.ErroEmissao,
  service_not_provided: JustificativaCancelamento.ServicoNaoPrestado,
  other: JustificativaCancelamento.Outros,
};
```

- Ajustar as assinaturas privadas (os corpos não mudam): `private store(payload: Pick<IIssuePayload, 'invoiceId' | 'tenantId'>): RetryStore` e `private client(payload: Pick<IIssuePayload, 'environment' | 'pfxBuffer' | 'p12Password'>, retryStore?: RetryStore): NfseClient`.
- Novo método público:

```ts
  /** Event 101101. The pending_emission slot (free once authorized) holds the signed event for replay. */
  async cancel(payload: ICancelPayload): Promise<FiscalCancelResult> {
    const store = this.store(payload);
    const client = this.client(payload, store);
    try {
      const [pending] = await store.list();
      if (pending?.kind === 'cancelamento_simples') {
        const [replayed] = await client.replayPendingEvents(store);
        if (replayed?.status === 'success') return { status: 'cancelled' };
        if (replayed?.status === 'failed_permanent')
          return this.cancelRejection(replayed.error);
        return {
          status: 'pending',
          errorMessage:
            replayed?.status === 'still_pending'
              ? replayed.error.message
              : 'Awaiting fiscal retry window',
        };
      }
      const result = await client.cancelar({
        chaveAcesso: payload.accessKey,
        autor: { CNPJ: payload.emitenteCnpj },
        cMotivo: CANCELLATION_REASON[payload.reason],
        xMotivo: payload.description,
        retryStore: store,
      });
      return result.status === 'ok'
        ? { status: 'cancelled' }
        : { status: 'pending', errorMessage: result.error.message };
    } catch (error) {
      if (
        error instanceof ReceitaRejectionError ||
        error instanceof ValidationError
      )
        return this.cancelRejection(error);
      throw error;
    } finally {
      await client.close();
    }
  }

  private cancelRejection(error: Error): FiscalCancelResult {
    return {
      status: 'rejected',
      errorCode:
        error instanceof ReceitaRejectionError
          ? error.codigo
          : 'INVALID_FISCAL_INPUT',
      errorMessage: error.message,
    };
  }
```

- [ ] **Step 6: Implementar o `FakeNfseProvider`**

Em `api/src/infra/external/nfse/fake-nfse.provider.ts`, importar `ICancelPayload` e `FiscalCancelResult` e acrescentar:

```ts
  // eslint-disable-next-line @typescript-eslint/require-await
  async cancel(payload: ICancelPayload): Promise<FiscalCancelResult> {
    if (payload.environment !== 'test')
      throw new Error('Simulation is available only in test');
    return { status: 'cancelled' };
  }
```

- [ ] **Step 7: Rodar e ver passar**

Run: `yarn jest src/infra/external/nfse && yarn tsc --noEmit -p tsconfig.json`
Expected: PASS e nenhum erro de tipo (qualquer outro `FiscalProvider` que apareça no `tsc` precisa ganhar `cancel`).

- [ ] **Step 8: Commit**

```bash
git add api/src/infra/external/nfse api/test/__mocks__/open-nfse.ts
git commit -m "feat(nfse): cancel issued NFS-e through event 101101"
```

---

### Task 7: Pipeline assíncrono — handler, serviço e processor

**Files:**
- Create: `api/src/modules/invoice/application/invoice-cancel.handler.ts`
- Create: `api/src/modules/invoice/application/nfse-cancellation.service.ts`
- Create: `api/src/modules/invoice/jobs/nfse-cancellation.processor.ts`
- Modify: `api/src/modules/invoice/invoice.module.ts`
- Modify: `api/src/worker-app.module.ts`
- Test: `api/src/modules/invoice/application/invoice-cancel.handler.spec.ts` (novo)
- Test: `api/src/modules/invoice/application/nfse-cancellation.service.spec.ts` (novo)
- Test: `api/src/modules/invoice/jobs/nfse-emission.processor.spec.ts` (incluir o processor novo no loop)

**Interfaces:**
- Consumes: `Invoice.confirmCancellation/rejectCancellation/cancellationReason` (Task 1), `lifecycle.transition` (Task 3), `InvoiceWebhookPublisher.publish` (Task 4), `FiscalProvider.cancel` (Task 6), `FiscalJobData` (`./nfse-workflow.service`).
- Produces:
  - `INVOICE_CANCEL = 'invoice.cancel'`.
  - `cancellationMessage(invoice: Invoice, event: InvoiceEvent): NewOutboxMessage` (usada pela Task 8).
  - `NfseCancellationService.process(data: FiscalJobData): Promise<void>`.
  - Fila `nfse-cancellation`.

- [ ] **Step 1: Testes que falham**

Criar `api/src/modules/invoice/application/invoice-cancel.handler.spec.ts`:

```ts
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import {
  INVOICE_CANCEL,
  InvoiceCancelHandler,
  cancellationMessage,
} from './invoice-cancel.handler';
import { OutboxHandlerRegistry } from './outbox-handler.registry';

describe('InvoiceCancelHandler', () => {
  it('builds one outbox message per cancellation request', () => {
    const created = Invoice.create(
      {
        companyId: 'c1',
        environment: 'live',
        customer: { taxId: VALID_CNPJ, name: 'Cliente' },
        service: {
          description: 'Serviço',
          code: '010101',
          municipalityCode: '3550308',
        },
        amount: 100,
        competenceDate: new Date('2026-10-14'),
      },
      't1',
    );
    const invoice = Invoice.reconstitute({
      ...created.toSnapshot(),
      status: 'authorized',
      authorizedAt: new Date(),
    });
    const event = invoice.requestCancellation(
      cancellationReason('issue_error', 'Valor informado incorretamente'),
    );
    expect(cancellationMessage(invoice, event)).toEqual({
      tenantId: 't1',
      environment: 'live',
      type: INVOICE_CANCEL,
      aggregateId: invoice.id,
      dedupeKey: `cancellation:${event.id}`,
      payload: {
        invoiceId: invoice.id,
        companyId: 'c1',
        tenantId: 't1',
        requestId: event.id,
      },
    });
  });

  it('publishes nfse-cancellation with a per-request job id', async () => {
    const queue = { add: jest.fn() };
    const handler = new InvoiceCancelHandler(
      queue as never,
      new OutboxHandlerRegistry(),
    );
    await handler.handle({
      id: 'm1',
      tenantId: 't1',
      environment: 'live',
      type: INVOICE_CANCEL,
      aggregateId: 'i1',
      dedupeKey: 'cancellation:e1',
      status: 'claimed',
      availableAt: new Date(),
      leaseUntil: null,
      attempts: 1,
      lastError: null,
      payload: { invoiceId: 'i1', companyId: 'c1', tenantId: 't1', requestId: 'e1' },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'nfse-cancellation',
      'cancel',
      { invoiceId: 'i1', companyId: 'c1', tenantId: 't1' },
      {
        idempotencyKey: 'cancellation-e1',
        attempts: 8,
        backoffMs: 60000,
        removeOnComplete: false,
        removeOnFail: 1000,
      },
    );
  });

  it('registers itself on module init', () => {
    const registry = new OutboxHandlerRegistry();
    const handler = new InvoiceCancelHandler({} as never, registry);
    handler.onModuleInit();
    expect(registry.get(INVOICE_CANCEL)).toBe(handler);
  });
});
```

Criar `api/src/modules/invoice/application/nfse-cancellation.service.spec.ts`:

```ts
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import { cancellationReason } from '../domain/cancellation-reason';
import type { InvoiceStatus } from '../domain/invoice-status';
import { NfseCancellationService } from './nfse-cancellation.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function cancelling(environment: 'test' | 'live' = 'test'): Invoice {
  const created = Invoice.create(
    {
      companyId: 'company-1',
      environment,
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    tenantId,
  );
  const invoice = Invoice.reconstitute({
    ...created.toSnapshot(),
    status: 'authorized' as InvoiceStatus,
    authorizedAt: new Date(),
    accessKey: '9'.repeat(50),
  });
  invoice.requestCancellation(
    cancellationReason('issue_error', 'Valor informado incorretamente'),
  );
  return invoice;
}

function build(invoice: Invoice | null, result: unknown) {
  const provider = { cancel: jest.fn().mockResolvedValue(result) };
  const lifecycle = { transition: jest.fn() };
  const webhooks = { publish: jest.fn() };
  const certificates = {
    decryptCredentials: jest
      .fn()
      .mockResolvedValue({ pfxBuffer: Buffer.from('pfx'), password: 'pw' }),
  };
  const service = new NfseCancellationService(
    { findByIdAndTenantId: jest.fn().mockResolvedValue(invoice) } as never,
    {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'company-1', taxId: '11222333000181' }),
    } as never,
    certificates as never,
    { resolve: jest.fn().mockReturnValue(provider) } as never,
    lifecycle as never,
    webhooks as never,
  );
  return { service, provider, lifecycle, webhooks, certificates };
}

const job = (invoice: Invoice) => ({ invoiceId: invoice.id, tenantId });

describe('NfseCancellationService', () => {
  it('confirms the cancellation and notifies when the Sefin accepts it', async () => {
    const invoice = cancelling();
    const ctx = build(invoice, { status: 'cancelled' });
    await ctx.service.process(job(invoice));
    expect(ctx.provider.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        accessKey: '9'.repeat(50),
        emitenteCnpj: '11222333000181',
        reason: 'issue_error',
        description: 'Valor informado incorretamente',
        environment: 'test',
      }),
    );
    expect(invoice.status).toBe('cancelled');
    expect(ctx.lifecycle.transition).toHaveBeenCalledTimes(1);
    expect(ctx.webhooks.publish).toHaveBeenCalledWith(
      invoice,
      'nfse.invoice.cancelled',
      { reason: 'issue_error' },
    );
  });

  it('restores authorized with the error when the Sefin rejects it', async () => {
    const invoice = cancelling();
    const ctx = build(invoice, {
      status: 'rejected',
      errorCode: 'E0840',
      errorMessage: 'Prazo expirado',
    });
    await ctx.service.process(job(invoice));
    expect(invoice.status).toBe('authorized');
    expect(ctx.webhooks.publish).toHaveBeenCalledWith(
      invoice,
      'nfse.invoice.cancellation_rejected',
      { errorCode: 'E0840', errorMessage: 'Prazo expirado' },
    );
  });

  it('throws so BullMQ retries when the result is still pending', async () => {
    const invoice = cancelling();
    const ctx = build(invoice, { status: 'pending', errorMessage: 'timeout' });
    await expect(ctx.service.process(job(invoice))).rejects.toThrow('timeout');
    expect(invoice.status).toBe('cancelling');
    expect(ctx.lifecycle.transition).not.toHaveBeenCalled();
  });

  it('decrypts the company certificate in live', async () => {
    const invoice = cancelling('live');
    const ctx = build(invoice, { status: 'cancelled' });
    await ctx.service.process(job(invoice));
    expect(ctx.certificates.decryptCredentials).toHaveBeenCalledWith(
      'company-1',
      tenantId,
      'live',
    );
    expect(ctx.provider.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ p12Password: 'pw' }),
    );
  });

  it('does nothing for an invoice that is no longer cancelling', async () => {
    const invoice = cancelling();
    invoice.confirmCancellation();
    const ctx = build(invoice, { status: 'cancelled' });
    await ctx.service.process(job(invoice));
    expect(ctx.provider.cancel).not.toHaveBeenCalled();
  });
});
```

Em `api/src/modules/invoice/jobs/nfse-emission.processor.spec.ts`, importar `NfseCancellationProcessor` de `'./nfse-cancellation.processor'` e trocar o loop por `for (const Processor of [NfseEmissionProcessor, NfseReconciliationProcessor, NfseCancellationProcessor]) {`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/invoice/application/invoice-cancel.handler.spec.ts src/modules/invoice/application/nfse-cancellation.service.spec.ts src/modules/invoice/jobs/nfse-emission.processor.spec.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Handler da outbox**

Criar `api/src/modules/invoice/application/invoice-cancel.handler.ts`:

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { OutboxHandler } from '../domain/outbox-handler';
import type { NewOutboxMessage, OutboxMessage } from '../domain/outbox-message';
import type { Invoice } from '../domain/invoice';
import type { InvoiceEvent } from '../domain/invoice-event';
import { OutboxHandlerRegistry } from './outbox-handler.registry';

export const INVOICE_CANCEL = 'invoice.cancel';

/** Each request has its own key, so a cancellation retried after a rejection is a new message. */
export function cancellationMessage(
  invoice: Invoice,
  event: InvoiceEvent,
): NewOutboxMessage {
  return {
    tenantId: invoice.tenantId,
    environment: invoice.environment,
    type: INVOICE_CANCEL,
    aggregateId: invoice.id,
    dedupeKey: `cancellation:${event.id}`,
    payload: {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      tenantId: invoice.tenantId,
      requestId: event.id,
    },
  };
}

@Injectable()
export class InvoiceCancelHandler implements OutboxHandler, OnModuleInit {
  readonly type = INVOICE_CANCEL;

  constructor(
    private readonly queue: BullmqQueueService,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { invoiceId, companyId, tenantId, requestId } = message.payload as {
      invoiceId: string;
      companyId: string;
      tenantId: string;
      requestId: string;
    };
    await this.queue.add(
      'nfse-cancellation',
      'cancel',
      { invoiceId, companyId, tenantId },
      {
        idempotencyKey: `cancellation-${requestId}`,
        attempts: 8,
        backoffMs: 60000,
        removeOnComplete: false,
        removeOnFail: 1000,
      },
    );
  }
}
```

- [ ] **Step 4: Serviço de cancelamento**

Criar `api/src/modules/invoice/application/nfse-cancellation.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { CompanyService } from '@/modules/company/application/company.service';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import { NfseProviderFactory } from '@/infra/external/nfse/nfse-provider.factory';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import type { Invoice } from '../domain/invoice';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import type { FiscalJobData } from './nfse-workflow.service';

/** Sends the cancellation event of a `cancelling` invoice and records the Sefin outcome. */
@Injectable()
export class NfseCancellationService {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    private readonly companies: CompanyService,
    private readonly certificates: ApplicationCertificateDecryptor,
    private readonly providers: NfseProviderFactory,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly webhooks: InvoiceWebhookPublisher,
  ) {}

  async process(data: FiscalJobData): Promise<void> {
    return runWithTenant(data.tenantId, () => this.processTenant(data));
  }

  private async processTenant(data: FiscalJobData): Promise<void> {
    const invoice = await this.invoices.findByIdAndTenantId(
      data.invoiceId,
      data.tenantId,
    );
    if (!invoice || invoice.status !== 'cancelling') return;
    const reason = invoice.cancellationReason;
    if (!reason?.description || !invoice.accessKey)
      throw new Error('Cancelling invoice lacks reason or access key');
    const company = await this.companies.findById(
      invoice.companyId,
      invoice.tenantId,
      invoice.environment,
    );
    const credentials = await this.credentials(invoice, company.id);
    const result = await this.providers.resolve(invoice.environment).cancel({
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      accessKey: invoice.accessKey,
      environment: invoice.environment,
      pfxBuffer: credentials.pfxBuffer,
      p12Password: credentials.password,
      emitenteCnpj: company.taxId,
      reason: reason.code,
      description: reason.description,
    });
    if (result.status === 'pending')
      throw new Error(`Cancellation pending at Sefin: ${result.errorMessage}`);
    if (result.status === 'cancelled') {
      await this.lifecycle.transition(invoice, invoice.confirmCancellation());
      await this.webhooks.publish(invoice, 'nfse.invoice.cancelled', {
        reason: reason.code,
      });
      return;
    }
    await this.lifecycle.transition(
      invoice,
      invoice.rejectCancellation(result.errorCode, result.errorMessage),
    );
    await this.webhooks.publish(invoice, 'nfse.invoice.cancellation_rejected', {
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    });
  }

  private credentials(
    invoice: Invoice,
    companyId: string,
  ): Promise<{ pfxBuffer: Buffer; password: string }> {
    return invoice.environment === 'live'
      ? this.certificates.decryptCredentials(
          companyId,
          invoice.tenantId,
          invoice.environment,
        )
      : Promise.resolve({ pfxBuffer: Buffer.alloc(0), password: '' });
  }
}
```

- [ ] **Step 5: Processor**

Criar `api/src/modules/invoice/jobs/nfse-cancellation.processor.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { LockPort } from '@/infra/redis/lock.port';
import { LOCK_PORT } from '@/infra/redis/redis.constants';
import type { FiscalJobData } from '../application/nfse-workflow.service';
import { NfseCancellationService } from '../application/nfse-cancellation.service';

@Processor('nfse-cancellation')
@Injectable()
export class NfseCancellationProcessor extends WorkerHost {
  constructor(
    @Inject(LOCK_PORT) private readonly locks: LockPort,
    private readonly cancellation: NfseCancellationService,
  ) {
    super();
  }
  async process(job: Job<FiscalJobData>): Promise<void> {
    // Same lock as emission/reconciliation: one fiscal operation per invoice.
    const lock = await this.locks.acquire(
      `nfse:invoice:${job.data.invoiceId}`,
      { ttlMs: 300000 },
    );
    if (!lock) throw new Error('Invoice is already being processed');
    try {
      await this.cancellation.process(job.data);
    } finally {
      await this.locks.release(lock);
    }
  }
}
```

O loop do spec existente chama `processor.process` e espera que ele delegue para `workflow.process`. Como o mock é posicional e o objeto passado tem o método `process`, o mesmo teste vale para o `NfseCancellationService`.

- [ ] **Step 6: Wiring**

Em `api/src/modules/invoice/invoice.module.ts`: acrescentar `{ name: 'nfse-cancellation' }` ao `BullModule.registerQueue(...)` e `InvoiceCancelHandler` aos `providers` (ao lado de `InvoiceEmitHandler`).

Em `api/src/worker-app.module.ts`: importar `NfseCancellationService` e `NfseCancellationProcessor` e acrescentá-los a `providers` (depois de `NfseReconciliationProcessor`).

- [ ] **Step 7: Rodar e ver passar**

Run: `yarn jest src/modules/invoice src/worker-app.module-composition.spec.ts src/runtime-wiring.spec.ts`
Expected: PASS. Se `outbox-wiring.spec.ts` ou o spec de composição fixarem a lista de handlers ou filas, acrescentar `invoice.cancel` ou `nfse-cancellation` à expectativa.

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/invoice api/src/worker-app.module.ts
git commit -m "feat(invoice): process fiscal cancellations through outbox and BullMQ"
```

---

### Task 8: `InvoiceService.cancel`, endpoint e documentação da API

**Files:**
- Modify: `api/src/modules/invoice/application/invoice.service.ts`
- Modify: `api/src/modules/invoice/http/invoice.dto.ts`
- Modify: `api/src/modules/invoice/http/invoice.controller.ts`
- Modify: `api/FRONTEND_API.md`
- Modify: `api/llms.txt`
- Test: `api/src/modules/invoice/application/invoice.service.cancel.spec.ts` (novo)
- Test: `api/src/modules/invoice/http/invoice.controller.spec.ts`
- Test: `api/src/modules/invoice/application/invoice.service.spec.ts` (documentos de nota cancelada)

**Interfaces:**
- Consumes: `cancellationReason` (Task 1), `lifecycle.transition(invoice, event, message?)` (Task 3), `InvoiceWebhookPublisher` (Task 4), `cancellationMessage` (Task 7).
- Produces:
  - `CancelInvoiceDto { reason: CancellationReasonCode; description?: string }`.
  - `InvoiceService.cancel(id: string, tenantId: string, environment: ExecutionEnvironment, input: CancelInvoiceDto): Promise<Invoice>`. O construtor ganha `webhooks: InvoiceWebhookPublisher` como **último** parâmetro.

- [ ] **Step 1: Testes que falham**

Criar `api/src/modules/invoice/application/invoice.service.cancel.spec.ts`:

```ts
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';
import { Invoice } from '../domain/invoice';
import {
  InvoiceNotCancellableError,
  InvalidCancellationReasonError,
} from '../domain/errors';
import type { InvoiceStatus } from '../domain/invoice-status';
import { InvoiceService } from './invoice.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function invoiceIn(status: InvoiceStatus): Invoice {
  const created = Invoice.create(
    {
      companyId: 'company-1',
      environment: 'test',
      customer: { taxId: VALID_CNPJ, name: 'Cliente' },
      service: {
        description: 'Serviço',
        code: '010101',
        municipalityCode: '3550308',
      },
      amount: 100,
      competenceDate: new Date('2026-10-14'),
    },
    tenantId,
  );
  return Invoice.reconstitute({
    ...created.toSnapshot(),
    status,
    authorizedAt: status === 'queued' ? null : new Date(),
  });
}

function build(invoice: Invoice) {
  const lifecycle = { transition: jest.fn() };
  const webhooks = { publish: jest.fn() };
  const service = new InvoiceService(
    { findByIdAndTenantId: jest.fn().mockResolvedValue(invoice) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    lifecycle as never,
    {} as never,
    {} as never,
    webhooks as never,
  );
  return { service, lifecycle, webhooks };
}

const fiscal = {
  reason: 'issue_error' as const,
  description: 'Valor do serviço informado incorretamente',
};

describe('InvoiceService.cancel', () => {
  it('cancels a queued invoice locally and notifies without an outbox message', async () => {
    const invoice = invoiceIn('queued');
    const { service, lifecycle, webhooks } = build(invoice);
    const result = await service.cancel(invoice.id, tenantId, 'test', {
      reason: 'other',
    });
    expect(result.status).toBe('cancelled');
    expect(lifecycle.transition).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({}),
      undefined,
    );
    expect(webhooks.publish).toHaveBeenCalledWith(
      invoice,
      'nfse.invoice.cancelled',
      { reason: 'other' },
    );
  });

  it('requests a fiscal cancellation with an outbox message for an authorized invoice', async () => {
    const invoice = invoiceIn('authorized');
    const { service, lifecycle, webhooks } = build(invoice);
    const result = await service.cancel(invoice.id, tenantId, 'test', fiscal);
    expect(result.status).toBe('cancelling');
    const message = lifecycle.transition.mock.calls[0][2];
    expect(message).toMatchObject({
      type: 'invoice.cancel',
      aggregateId: invoice.id,
    });
    expect(webhooks.publish).not.toHaveBeenCalled();
  });

  it.each(['cancelling', 'cancelled'] as const)(
    'is idempotent for an invoice already %s',
    async (status) => {
      const invoice = invoiceIn(status);
      const { service, lifecycle } = build(invoice);
      await expect(
        service.cancel(invoice.id, tenantId, 'test', fiscal),
      ).resolves.toBe(invoice);
      expect(lifecycle.transition).not.toHaveBeenCalled();
    },
  );

  it('refuses an invoice that is being issued', async () => {
    const invoice = invoiceIn('processing');
    const { service } = build(invoice);
    await expect(
      service.cancel(invoice.id, tenantId, 'test', fiscal),
    ).rejects.toBeInstanceOf(InvoiceNotCancellableError);
  });

  it('refuses a fiscal cancellation without a valid description', async () => {
    const invoice = invoiceIn('authorized');
    const { service, lifecycle } = build(invoice);
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).rejects.toBeInstanceOf(InvalidCancellationReasonError);
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });
});
```

Em `api/src/modules/invoice/application/invoice.service.spec.ts`, acrescentar um teste em `describe('getDownloadUrl')` seguindo os mocks já existentes no arquivo (`invoiceRepo.findByIdAndTenantId`, `documentStorage.getSignedUrl`). Ele monta uma invoice `cancelled` com `authorizedAt` e `documentsReadyAt` preenchidos e espera que `getDownloadUrl` **resolva** em vez de lançar `ConflictException`. Acrescentar outro em `describe('requestEmail')` (ou criar o bloco) que espera `ConflictException` para a mesma invoice cancelada. Monte a invoice como nos outros testes do arquivo, trocando `status: 'authorized'` por `status: 'cancelled'`.

Em `api/src/modules/invoice/http/invoice.controller.spec.ts`, acrescentar (adaptando o `controller` e o mock de `invoiceService` já criados no arquivo):

```ts
  describe('cancel', () => {
    const req = {
      authContext: { activeTenantId: 'tenant-1', executionEnvironment: 'test' },
    } as any;

    it.each([
      ['cancelled', 200],
      ['cancelling', 202],
    ] as const)('answers %s with HTTP %i', async (status, code) => {
      const invoice = { status };
      invoiceService.cancel = jest.fn().mockResolvedValue(invoice);
      const res = { status: jest.fn() } as any;
      await expect(
        controller.cancel('inv-1', { reason: 'other' }, req, res),
      ).resolves.toBe(invoice);
      expect(res.status).toHaveBeenCalledWith(code);
      expect(invoiceService.cancel).toHaveBeenCalledWith(
        'inv-1',
        'tenant-1',
        'test',
        { reason: 'other' },
      );
    });
  });
```

(Se o spec do controller construir o `authContext` de outra forma para `executionEnvironment(...)`, use o mesmo formato dos testes vizinhos.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/invoice/application/invoice.service.cancel.spec.ts src/modules/invoice/application/invoice.service.spec.ts src/modules/invoice/http/invoice.controller.spec.ts`
Expected: FAIL (`service.cancel is not a function`, download de nota cancelada recusado).

- [ ] **Step 3: DTO**

Em `api/src/modules/invoice/http/invoice.dto.ts` (acrescentar `MaxLength` ao import de `class-validator` e `ApiProperty` ao de `@nestjs/swagger`):

```ts
export class CancelInvoiceDto {
  @IsIn(CANCELLATION_REASON_CODES)
  @ApiProperty({ enum: CANCELLATION_REASON_CODES })
  reason!: CancellationReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiPropertyOptional({
    description:
      'Required (15–255 characters) to cancel an authorized NFS-e; optional for a queued invoice.',
  })
  description?: string;
}
```

com `import { CANCELLATION_REASON_CODES, type CancellationReasonCode } from '../domain/cancellation-reason';`.

- [ ] **Step 4: Serviço**

Em `api/src/modules/invoice/application/invoice.service.ts`:
- Imports: `cancellationReason` de `'../domain/cancellation-reason'`, `cancellationMessage` de `'./invoice-cancel.handler'`, `InvoiceWebhookPublisher` de `'./invoice-webhook.publisher'` e `CancelInvoiceDto` (junto de `CreateInvoiceDto`).
- Construtor: acrescentar `private readonly webhooks: InvoiceWebhookPublisher,` como **último** parâmetro.
- Novo método (depois de `findById`):

```ts
  /** Local for a queued invoice; otherwise requests the fiscal event and returns `cancelling`. */
  async cancel(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    input: CancelInvoiceDto,
  ): Promise<Invoice> {
    const invoice = await this.findById(id, tenantId, environment);
    if (invoice.status === 'cancelling' || invoice.status === 'cancelled')
      return invoice;
    const event = invoice.requestCancellation(
      cancellationReason(input.reason, input.description),
    );
    const fiscal = invoice.status === 'cancelling';
    await this.lifecycle.transition(
      invoice,
      event,
      fiscal ? cancellationMessage(invoice, event) : undefined,
    );
    if (!fiscal)
      await this.webhooks.publish(invoice, 'nfse.invoice.cancelled', {
        reason: input.reason,
      });
    return invoice;
  }
```

- Documentos de nota cancelada: em `getXml` e `getPdf`, trocar `if (invoice.status !== 'authorized')` por `if (!invoice.wasAuthorized)`. Em `getDownloadUrl`, trocar `invoice.status !== 'authorized' || !invoice.documentsReadyAt` por `!invoice.wasAuthorized || !invoice.documentsReadyAt`. **Não** alterar `requestEmail` (continua exigindo `authorized`).

Os specs `invoice.service.spec.ts`, `invoice.service.company-resolution.spec.ts` e `invoice.service.defaults.spec.ts` constroem o serviço por posição. Se o `tsc` ou o Jest reclamar do número de argumentos, acrescentar `{} as any` como último argumento nas três chamadas `new InvoiceService(`.

- [ ] **Step 5: Controller**

Em `api/src/modules/invoice/http/invoice.controller.ts`, importar `CancelInvoiceDto` e acrescentar depois de `requestEmail`:

```ts
  @Post(':id/cancel')
  @HttpCode(202)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary:
      'Cancel an invoice: 200 when a queued invoice is cancelled locally, 202 while the NFS-e cancellation event is processed',
  })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelInvoiceDto,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const invoice = await this.invoiceService.cancel(
      id,
      req.authContext!.activeTenantId,
      executionEnvironment(req.authContext!),
      dto,
    );
    res.status(invoice.status === 'cancelled' ? 200 : 202);
    return invoice;
  }
```

- [ ] **Step 6: Documentação da API**

Em `api/FRONTEND_API.md`:
- Na tabela de rotas, depois da linha de `/invoices/{id}/email`:

```
| POST   | `/invoices/{id}/cancel`                                | S/K, `nfse.invoices.issue`      | JSON: `reason`, `description?`; 200 (queued → cancelled) ou 202 (authorized → cancelling) |
```

- Depois da seção `**POST /invoices/{id}/email**`, uma seção nova:

```markdown
**POST /invoices/{id}/cancel** - Cancela uma nota.

Body: `{ "reason": "issue_error" | "service_not_provided" | "other", "description"?: string }`.

- Nota `queued` (agendada ou ainda não processada): cancelada na hora, `200` com `status: "cancelled"`. Em live, o crédito reservado é estornado. `description` é opcional.
- Nota `authorized`: `202` com `status: "cancelling"`. O evento 101101 é enviado à Sefin em segundo plano. `description` é obrigatória (15–255 caracteres). Resultado: `cancelled` (webhook `nfse.invoice.cancelled`) ou de volta a `authorized` com `lastErrorCode/lastErrorMessage` (webhook `nfse.invoice.cancellation_rejected`). O crédito não é devolvido.
- Nota já `cancelling`/`cancelled`: devolve o estado atual.
- Erros: `409 ERROR_INVOICE_NOT_CANCELLABLE` (outros status), `409 ERROR_CONCURRENT_INVOICE_TRANSITION` (a emissão começou durante o pedido), `422 ERROR_INVALID_CANCELLATION_REASON`.
- Campos novos na invoice: `cancellationReason`, `cancellationDescription`, `cancelledAt`. XML/PDF continuam disponíveis depois do cancelamento; o reenvio de e-mail não.
```

- Na linha de `Webhook events` (perto da linha 430), acrescentar `` `nfse.invoice.cancelled`, `nfse.invoice.cancellation_rejected` ``.

Em `api/llms.txt`, depois do parágrafo "Invoice intake and scheduling":

```
## Invoice cancellation

POST /v1/invoices/:id/cancel with {"reason": "issue_error" | "service_not_provided"
| "other", "description"?: string}. A queued invoice (scheduled or not yet
processed) is cancelled locally: HTTP 200, status cancelled, live credit
reservation refunded. An authorized invoice returns HTTP 202 with status
cancelling; description (15-255 chars) is required and event 101101 is sent to
the Sefin asynchronously. Outcome: cancelled (webhook nfse.invoice.cancelled) or
back to authorized with lastErrorCode/lastErrorMessage (webhook
nfse.invoice.cancellation_rejected). Other statuses return 409
ERROR_INVOICE_NOT_CANCELLABLE. Cancelling an issued NFS-e does not refund credit.
```

- [ ] **Step 7: Rodar e ver passar**

Run: `yarn jest src/modules/invoice src/infra/openapi src/shared/http && yarn tsc --noEmit -p tsconfig.json && yarn lint`
Expected: PASS, sem erros de tipo ou de lint.

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/invoice api/FRONTEND_API.md api/llms.txt
git commit -m "feat(invoice): expose POST /v1/invoices/:id/cancel"
```

---

### Task 9: Tool MCP `nfse_cancel`

**Files:**
- Create: `api/src/modules/mcp/tools/nfse-cancel.tool.ts`
- Modify: `api/src/modules/mcp/dto/tool-input.dto.ts`
- Modify: `api/src/modules/mcp/mcp.service.ts`
- Test: `api/src/modules/mcp/tools/nfse-cancel.tool.spec.ts` (novo)

**Interfaces:**
- Consumes: `InvoiceService.cancel` (Task 8), `CANCELLATION_REASON_CODES` (Task 1).
- Produces: `NFSE_CANCEL_TOOL`, `createNfseCancelHandler(invoiceService)`, que devolve `{ invoice_id, status, cancelled_at }`.

- [ ] **Step 1: Teste que falha**

Criar `api/src/modules/mcp/tools/nfse-cancel.tool.spec.ts`:

```ts
import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { createNfseCancelHandler } from './nfse-cancel.tool';

const ctx = {
  tenantId: 'tenant-1',
  activeTenantId: 'tenant-1',
  executionEnvironment: 'test',
} as unknown as AuthContext;
const invoiceId = '09947127-2702-4f6d-9da8-cb463608d812';

describe('nfse_cancel tool', () => {
  it('delegates to InvoiceService.cancel in the caller tenant and environment', async () => {
    const cancel = jest.fn().mockResolvedValue({
      id: invoiceId,
      status: 'cancelling',
      cancelledAt: null,
    });
    const handler = createNfseCancelHandler({
      cancel,
    } as unknown as InvoiceService);
    await expect(
      handler(
        {
          invoice_id: invoiceId,
          reason: 'issue_error',
          description: 'Valor informado incorretamente',
        },
        ctx,
      ),
    ).resolves.toEqual({
      invoice_id: invoiceId,
      status: 'cancelling',
      cancelled_at: null,
    });
    expect(cancel).toHaveBeenCalledWith(invoiceId, 'tenant-1', 'test', {
      reason: 'issue_error',
      description: 'Valor informado incorretamente',
    });
  });

  it('rejects an unknown reason before calling the service', async () => {
    const cancel = jest.fn();
    const handler = createNfseCancelHandler({
      cancel,
    } as unknown as InvoiceService);
    await expect(
      handler({ invoice_id: invoiceId, reason: 'because' }, ctx),
    ).rejects.toThrow('Invalid input: reason');
    expect(cancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/mcp/tools/nfse-cancel.tool.spec.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

Em `api/src/modules/mcp/dto/tool-input.dto.ts` (acrescentar `IsIn` e `MaxLength` aos imports de `class-validator` se faltarem):

```ts
export class NfseCancelInput {
  @IsUUID() invoice_id!: string;
  @IsIn(CANCELLATION_REASON_CODES) reason!: CancellationReasonCode;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
}
```

com `import { CANCELLATION_REASON_CODES, type CancellationReasonCode } from '@/modules/invoice/domain/cancellation-reason';`.

Criar `api/src/modules/mcp/tools/nfse-cancel.tool.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { InvoiceService } from '@/modules/invoice/application/invoice.service';
import { NfseCancelInput } from '../dto/tool-input.dto';

export const NFSE_CANCEL_TOOL = {
  name: 'nfse_cancel',
  description:
    'Cancel an invoice. A queued (scheduled or not yet issued) invoice is cancelled immediately; an authorized NFS-e returns status "cancelling" while the cancellation event is sent to the Sefin. Issued NFS-e require a 15-255 character description.',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: { type: 'string', description: 'UUID of the invoice' },
      reason: {
        type: 'string',
        enum: ['issue_error', 'service_not_provided', 'other'],
      },
      description: {
        type: 'string',
        description:
          'Free-text justification; required (15-255 chars) for an authorized NFS-e',
      },
    },
    required: ['invoice_id', 'reason'],
  },
} as const;

export function createNfseCancelHandler(
  invoiceService: Pick<InvoiceService, 'cancel'>,
) {
  return async function nfseCancelHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    invoice_id: string;
    status: string;
    cancelled_at: string | null;
  }> {
    const params = plainToInstance(
      NfseCancelInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0)
      throw new Error(
        `Invalid input: ${errors.map((e) => e.property).join(', ')}`,
      );
    const invoice = await invoiceService.cancel(
      params.invoice_id,
      ctx.activeTenantId,
      executionEnvironment(ctx),
      { reason: params.reason, description: params.description },
    );
    return {
      invoice_id: invoice.id,
      status: invoice.status,
      cancelled_at: invoice.cancelledAt?.toISOString() ?? null,
    };
  };
}
```

Em `api/src/modules/mcp/mcp.service.ts`, importar `NFSE_CANCEL_TOOL` e `createNfseCancelHandler` e registrar logo depois do `NFSE_ISSUE_TOOL`:

```ts
    this.server.registerTool(
      NFSE_CANCEL_TOOL,
      this.wrapWithScopeCheck(
        createNfseCancelHandler(this.invoiceService),
        'nfse:write',
      ),
    );
```

- [ ] **Step 4: Rodar e ver passar**

Run: `yarn jest src/modules/mcp`
Expected: PASS. Se algum spec ou e2e (`test/mcp-tools.e2e-spec.ts`) fixar a lista de tools, acrescentar `nfse_cancel` na expectativa.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/mcp
git commit -m "feat(mcp): add nfse_cancel tool"
```

---

### Task 10: Dashboard — cancelar pelo detalhe da nota

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/lib/api.ts`
- Create: `web/components/dashboard/cancel-invoice-dialog.tsx`
- Modify: `web/app/app/invoices/[id]/page.tsx`
- Modify: `web/components/dashboard/invoice-table.tsx`
- Modify: `web/messages/en.json`
- Modify: `web/messages/pt.json`
- Test: `web/tests/cancel-invoice-dialog.test.tsx` (novo)

**Interfaces:**
- Consumes: `POST /v1/invoices/:id/cancel` (Task 8).
- Produces: `type CancellationReasonCode`; `Invoice` com `cancellationReason?`, `cancellationDescription?`, `cancelledAt?`; `invoices.cancel(id, { reason, description? }): Promise<Invoice>`; `<CancelInvoiceDialog invoice open onClose onCancelled />`.

- [ ] **Step 1: Teste que falha**

Criar `web/tests/cancel-invoice-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelInvoiceDialog } from "@/components/dashboard/cancel-invoice-dialog";
import type { Invoice } from "@/lib/types";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), invoices: { cancel: mocks.cancel } }));

const base = { id: "inv-1", status: "authorized" } as Invoice;
const renderDialog = (invoice: Invoice, onCancelled = vi.fn()) => {
  render(<NextIntlClientProvider locale="en" messages={messages}><CancelInvoiceDialog invoice={invoice} open onClose={vi.fn()} onCancelled={onCancelled} /></NextIntlClientProvider>);
  return onCancelled;
};
const t = messages.InvoiceDetail.cancel;

afterEach(() => { cleanup(); mocks.cancel.mockReset(); });

describe("CancelInvoiceDialog", () => {
  it("requires a 15+ character description for an authorized invoice", () => {
    renderDialog(base);
    fireEvent.change(screen.getByLabelText(t.description), { target: { value: "too short" } });
    expect((screen.getByRole("button", { name: t.confirm }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the reason and trimmed description and reports the result", async () => {
    const updated = { ...base, status: "cancelling" } as Invoice;
    mocks.cancel.mockResolvedValue(updated);
    const onCancelled = renderDialog(base);
    fireEvent.change(screen.getByLabelText(t.reason), { target: { value: "service_not_provided" } });
    fireEvent.change(screen.getByLabelText(t.description), { target: { value: "  Serviço não foi prestado  " } });
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(updated));
    expect(mocks.cancel).toHaveBeenCalledWith("inv-1", { reason: "service_not_provided", description: "Serviço não foi prestado" });
  });

  it("allows cancelling a queued invoice without a description", async () => {
    mocks.cancel.mockResolvedValue({ ...base, status: "cancelled" });
    renderDialog({ ...base, status: "queued" } as Invoice);
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("inv-1", { reason: "issue_error", description: undefined }));
  });

  it("shows the API error and keeps the dialog open", async () => {
    mocks.cancel.mockRejectedValue(new Error("Invoice cannot be cancelled in its current status"));
    renderDialog({ ...base, status: "queued" } as Invoice);
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot be cancelled");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `web/`): `yarn vitest run tests/cancel-invoice-dialog.test.tsx`
Expected: FAIL (componente inexistente).

- [ ] **Step 3: Tipos e cliente**

Em `web/lib/types.ts`:
- `InvoiceStatus` ganha `| "cancelling" | "cancelled"`.
- Acrescentar `export type CancellationReasonCode = "issue_error" | "service_not_provided" | "other";`.
- Em `Invoice`, acrescentar `cancellationReason?: CancellationReasonCode | null; cancellationDescription?: string | null; cancelledAt?: string | null;`.
- Em `WEBHOOK_EVENT_OPTIONS`, acrescentar no fim:

```ts
  { value: "nfse.invoice.cancelled", label: "Invoice cancelled", description: "The invoice was cancelled (scheduled or at the Sefin)." },
  { value: "nfse.invoice.cancellation_rejected", label: "Cancellation rejected", description: "The Sefin refused the cancellation; the invoice stays authorized." },
```

Em `web/lib/api.ts`, importar `CancellationReasonCode` e acrescentar ao objeto `invoices`:

```ts
  cancel: async (id: string, data: { reason: CancellationReasonCode; description?: string }) => adaptInvoice(unwrap(await request<Envelope<InvoiceBody>>(`/invoices/${idPath(id)}/cancel`, json(data)))),
```

- [ ] **Step 4: Componente**

Criar `web/components/dashboard/cancel-invoice-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { invoices } from "@/lib/api";
import type { CancellationReasonCode, Invoice } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const REASONS: CancellationReasonCode[] = ["issue_error", "service_not_provided", "other"];

interface CancelInvoiceDialogProps {
  invoice: Invoice;
  open: boolean;
  onClose: () => void;
  onCancelled: (invoice: Invoice) => void;
}

/** Issued NFS-e need the Sefin justification (15–255 chars); queued ones are cancelled locally. */
export function CancelInvoiceDialog({ invoice, open, onClose, onCancelled }: CancelInvoiceDialogProps) {
  const t = useTranslations("InvoiceDetail.cancel");
  const fiscal = invoice.status === "authorized";
  const [reason, setReason] = useState<CancellationReasonCode>("issue_error");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = description.trim();
  const invalid = fiscal && (trimmed.length < 15 || trimmed.length > 255);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid || submitting) return;
    setSubmitting(true); setError(null);
    try { onCancelled(await invoices.cancel(invoice.id, { reason, description: trimmed || undefined })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("failed")); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-text-3">{t(fiscal ? "fiscalHint" : "queuedHint")}</p>
        <label className="flex flex-col gap-1.5 text-sm">
          {t("reason")}
          <select className="field" value={reason} onChange={(event) => setReason(event.target.value as CancellationReasonCode)}>
            {REASONS.map((code) => <option key={code} value={code}>{t(`reasons.${code}`)}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1.5 text-sm">
          <label className="flex flex-col gap-1.5">
            {t("description")}
            <textarea className="field resize-y" rows={3} maxLength={255} required={fiscal} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          {/* Outside the label so the field's accessible name stays "Justification". */}
          <span className="text-[12.5px] text-text-4">{t(fiscal ? "descriptionRequired" : "descriptionOptional")}</span>
        </div>
        {error && <p role="alert" className="banner banner-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>{t("keep")}</Button>
          <Button type="submit" variant="danger" loading={submitting} disabled={invalid}>{t("confirm")}</Button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 5: Página de detalhe e tabela**

Em `web/app/app/invoices/[id]/page.tsx`:
- Imports: `useAuth` de `"@/lib/auth"` e `CancelInvoiceDialog` de `"@/components/dashboard/cancel-invoice-dialog"`.
- `pending` passa a ser `new Set(["queued", "processing", "retry_pending", "cancelling"])`.
- `TONE` ganha `cancelling: "bg-warn", cancelled: "bg-text-4"`.
- Estado: `const { can } = useAuth(); const [cancelOpen, setCancelOpen] = useState(false);`. Coloque **junto dos outros hooks, no topo do componente**, antes do `if (!invoice || invoice.id !== id) return ...` (regra dos hooks).
- Antes do `return` principal: `const cancellable = can("nfse.invoices.issue") && (invoice.status === "queued" || invoice.status === "authorized"); const hasDocuments = Boolean(invoice.authorizedAt);`.
- `actions` do `PageHeader`:

```tsx
actions={<div className="flex gap-3">{cancellable && <Button variant="danger" onClick={() => setCancelOpen(true)}>{t("cancel.open")}</Button>}<Button onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>}
```

- Nos dois botões de documento, trocar `invoice.status !== "authorized"` por `!hasDocuments`, e no hint trocar `invoice.status !== "authorized" &&` por `!hasDocuments &&`.
- Depois do card de erro (`invoice.lastErrorMessage`), mostrar o motivo quando houver:

```tsx
{invoice.cancellationReason && <p className="banner">{t("cancel.recorded", { reason: t(`cancel.reasons.${invoice.cancellationReason}`) })}{invoice.cancellationDescription ? ` — ${invoice.cancellationDescription}` : ""}</p>}
```

- Antes do `</div>` final:

```tsx
{cancellable && <CancelInvoiceDialog invoice={invoice} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={(updated) => { setCancelOpen(false); setInvoice(updated); setRevision((value) => value + 1); }} />}
```

Em `web/components/dashboard/invoice-table.tsx`, acrescentar ao `STATUS_VARIANT`: `cancelling: "warn", cancelled: "gray",`.

- [ ] **Step 6: Mensagens**

Em `web/messages/en.json`:
- `Invoices.status`: `"cancelling": "Cancelling", "cancelled": "Cancelled"`.
- `InvoiceDetail.timeline`: `"cancelling": "We sent the cancellation to the Sefin and are waiting for the answer.", "cancelled": "The invoice was cancelled."`.
- `InvoiceDetail.cancel` (novo objeto):

```json
"cancel": {
  "open": "Cancel invoice",
  "title": "Cancel invoice",
  "fiscalHint": "The cancellation is sent to the Sefin. It may be refused (for example, after the municipal deadline). The credit used to issue it is not refunded.",
  "queuedHint": "This invoice has not been issued yet. It will be cancelled immediately and the reserved credit released.",
  "reason": "Reason",
  "reasons": { "issue_error": "Issuance error", "service_not_provided": "Service not provided", "other": "Other" },
  "description": "Justification",
  "descriptionRequired": "Required, 15 to 255 characters. Sent to the Sefin.",
  "descriptionOptional": "Optional.",
  "keep": "Keep invoice",
  "confirm": "Cancel invoice",
  "failed": "We couldn't cancel the invoice.",
  "recorded": "Cancellation reason: {reason}"
}
```

Em `web/messages/pt.json`, as mesmas chaves:
- `Invoices.status`: `"cancelling": "Cancelando", "cancelled": "Cancelada"`.
- `InvoiceDetail.timeline`: `"cancelling": "Enviamos o cancelamento à Sefin e aguardamos a resposta.", "cancelled": "A nota foi cancelada."`.
- `InvoiceDetail.cancel`:

```json
"cancel": {
  "open": "Cancelar nota",
  "title": "Cancelar nota",
  "fiscalHint": "O cancelamento é enviado à Sefin e pode ser recusado (por exemplo, fora do prazo municipal). O crédito usado na emissão não é devolvido.",
  "queuedHint": "Esta nota ainda não foi emitida. Ela será cancelada na hora e o crédito reservado será liberado.",
  "reason": "Motivo",
  "reasons": { "issue_error": "Erro na emissão", "service_not_provided": "Serviço não prestado", "other": "Outros" },
  "description": "Justificativa",
  "descriptionRequired": "Obrigatória, de 15 a 255 caracteres. Enviada à Sefin.",
  "descriptionOptional": "Opcional.",
  "keep": "Manter nota",
  "confirm": "Cancelar nota",
  "failed": "Não foi possível cancelar a nota.",
  "recorded": "Motivo do cancelamento: {reason}"
}
```

Atenção: em `en.json` o botão de abrir e o de confirmar têm o mesmo texto ("Cancel invoice"). O teste busca o botão de confirmação dentro do modal renderizado sozinho, então não há ambiguidade.

- [ ] **Step 7: Rodar e ver passar**

Run (em `web/`): `yarn vitest run && yarn lint && yarn tsc --noEmit`
Expected: PASS (inclusive `company-invoice-forms.test.tsx` e os testes de paridade de mensagens, se houver).

- [ ] **Step 8: Commit**

```bash
git add web/lib web/components/dashboard web/app/app/invoices web/messages web/tests/cancel-invoice-dialog.test.tsx
git commit -m "feat(web): cancel invoices from the invoice detail page"
```

---

### Task 11: Docs públicas (en/pt)

**Files:**
- Modify: `web/lib/docs/content/en.ts`
- Modify: `web/lib/docs/content/pt.ts`
- Modify: `web/tests/docs-parity.test.ts`

**Interfaces:**
- Consumes: o contrato da Task 8.

- [ ] **Step 1: Teste que falha**

Em `web/tests/docs-parity.test.ts`, trocar o título e os números de `"documents exactly 31 endpoint operations"` para 32 (`toHaveLength(32)`, `toBe(32)`).

Run: `yarn vitest run tests/docs-parity.test.ts`
Expected: FAIL (31 ≠ 32).

- [ ] **Step 2: Conteúdo em inglês**

Em `web/lib/docs/content/en.ts`:
1. Na tabela de visão geral (perto da linha 88), depois de `["POST", "\`/v1/invoices/:id/email\`", "Request email delivery", "202"],`: `["POST", "\`/v1/invoices/:id/cancel\`", "Cancel an invoice", "200/202"],`.
2. Nas duas listas de status fiscais (perto das linhas 815 e 1761), acrescentar `` `cancelling`, `cancelled` `` ao fim da enumeração.
3. Nas listas de eventos de webhook (perto das linhas 1195 e 1913), acrescentar `"\`nfse.invoice.cancelled\`"` e `"\`nfse.invoice.cancellation_rejected\`"`. Na tabela de eventos (linha 1913), as linhas devem ser `["\`nfse.invoice.cancelled\`", "The invoice was cancelled; adds \`reason\`."]` e `["\`nfse.invoice.cancellation_rejected\`", "The Sefin refused the cancellation; the invoice is \`authorized\` again; adds \`errorCode\` and \`errorMessage\`."]`.
4. Depois do bloco `endpoint` de `/v1/invoices/:id/email`, um bloco novo:

```ts
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/:id/cancel",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "200 OK / 202 Accepted",
          summary: "Cancels an invoice. A `queued` invoice (scheduled or not yet processed) is cancelled immediately; an `authorized` NFS-e moves to `cancelling` while event 101101 is sent to the Sefin.",
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/$INVOICE_ID/cancel" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"reason":"issue_error","description":"Service amount was informed incorrectly"}'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/cancel\`, {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "issue_error", description: "Service amount was informed incorrectly" }),
});
const body = await res.json();
console.log(res.status, body.data.props.status); // 202 "cancelling"`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "props": {
      "id": "6f1c0e2a-4b7d-4c1e-9a55-2b8f7c3d9e10",
      "status": "cancelling",
      "stage": "completed",
      "cancellationReason": "issue_error",
      "cancellationDescription": "Service amount was informed incorrectly",
      "cancelledAt": null
    }
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "`reason`: `issue_error`, `service_not_provided` or `other`. `description` is required (15–255 characters) for an authorized NFS-e and optional for a queued invoice. Repeating the request for a `cancelling` or `cancelled` invoice returns its current state." },
            { kind: "callout", tone: "warn", body: "`202` does not confirm the cancellation: wait for `nfse.invoice.cancelled` or `nfse.invoice.cancellation_rejected` (the invoice returns to `authorized` with `lastErrorCode`). Cancelling an issued NFS-e does not refund the credit; cancelling a queued invoice releases the live reservation. Errors: `404` invoice missing; `409` `ERROR_INVOICE_NOT_CANCELLABLE` or `ERROR_CONCURRENT_INVOICE_TRANSITION`; `422` `ERROR_INVALID_CANCELLATION_REASON`." },
          ],
        },
```

- [ ] **Step 3: Conteúdo em português**

Em `web/lib/docs/content/pt.ts`, mesmas posições e mesma estrutura (o teste de paridade compara tipos de bloco, endpoints e número de linhas das tabelas):
1. Visão geral, depois de `/v1/invoices/:id/email`: `["POST", "\`/v1/invoices/:id/cancel\`", "Cancelar nota", "200/202"],`.
2. Status fiscais: acrescentar `` `cancelling`, `cancelled` ``.
3. Eventos: `["\`nfse.invoice.cancelled\`", "A nota foi cancelada; inclui \`reason\`."]` e `["\`nfse.invoice.cancellation_rejected\`", "A Sefin recusou o cancelamento; a nota volta a \`authorized\`; inclui \`errorCode\` e \`errorMessage\`."]` (e as duas entradas na lista simples de eventos).
4. Bloco `endpoint` com `path: "/v1/invoices/:id/cancel"`, os mesmos `scopes`, `success`, `examples` e `response` do inglês (os exemplos de código podem ficar iguais; a descrição do exemplo vira `"Valor do serviço informado incorretamente"`), e textos traduzidos:
   - `summary`: "Cancela uma nota. Uma nota `queued` (agendada ou ainda não processada) é cancelada na hora; uma NFS-e `authorized` passa a `cancelling` enquanto o evento 101101 é enviado à Sefin."
   - nota 1: "`reason`: `issue_error`, `service_not_provided` ou `other`. `description` é obrigatória (15–255 caracteres) para NFS-e autorizada e opcional para nota `queued`. Repetir o pedido para uma nota `cancelling` ou `cancelled` devolve o estado atual."
   - nota 2: "`202` não confirma o cancelamento: aguarde `nfse.invoice.cancelled` ou `nfse.invoice.cancellation_rejected` (a nota volta a `authorized` com `lastErrorCode`). Cancelar uma NFS-e emitida não devolve o crédito; cancelar uma nota `queued` libera a reserva em live. Erros: `404` nota inexistente; `409` `ERROR_INVOICE_NOT_CANCELLABLE` ou `ERROR_CONCURRENT_INVOICE_TRANSITION`; `422` `ERROR_INVALID_CANCELLATION_REASON`."

- [ ] **Step 4: Rodar e ver passar**

Run (em `web/`): `yarn vitest run tests/docs-parity.test.ts tests/docs-registry.test.ts tests/docs-components.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verificação final e commit**

Run (raiz): `yarn lint && yarn typecheck && yarn test`
Expected: tudo verde. Registre no resumo os specs de Postgres que foram pulados por falta de `MIGRATION_TEST_DATABASE_URL`.

```bash
git add web/lib/docs/content web/tests/docs-parity.test.ts
git commit -m "docs(web): document invoice cancellation endpoint and webhooks"
```

---

### Task 12: Cancelamento concorrente — um único webhook e erro 409 claro

Emenda posterior às Tasks 3 e 8, decidida depois da revisão final (sem lock Redis: o lock por tenant dentro da transação do banco já serializa os pedidos).

**Files:**
- Modify: `api/src/modules/invoice/application/invoice-lifecycle.service.ts`
- Modify: `api/src/modules/invoice/application/invoice.service.ts`
- Modify: `api/FRONTEND_API.md`
- Modify: `web/lib/docs/content/en.ts`
- Modify: `web/lib/docs/content/pt.ts`
- Test: `api/src/modules/invoice/application/invoice-lifecycle.transition.spec.ts`
- Test: `api/src/modules/invoice/application/invoice.service.cancel.spec.ts`

**Interfaces:**
- Consumes: `ConcurrentInvoiceTransitionError` (Task 1), `InvoiceNotCancellableError` (Task 1), `InvoiceService.cancel` (Task 8).
- Produces: `InvoiceLifecycleService.transition(invoice, event, message?): Promise<boolean>` — `true` quando aplicou a mudança, `false` quando o status gravado já era o de destino. Os chamadores existentes ignoram o retorno e continuam válidos.

- [ ] **Step 1: Testes que falham**

Em `invoice-lifecycle.transition.spec.ts`, no `describe('InvoiceLifecycleService.transition — cancellation')`:

```ts
  it('reports true when it applies the transition', async () => {
    const ctx = build('queued', null);
    const invoice = invoiceIn('queued', 'test');
    await expect(
      ctx.service.transition(
        invoice,
        invoice.requestCancellation(cancellationReason('other')),
      ),
    ).resolves.toBe(true);
  });

  it('reports false and writes nothing when the stored status already is the target', async () => {
    const ctx = build('cancelled', null);
    const invoice = invoiceIn('queued', 'live');
    await expect(
      ctx.service.transition(
        invoice,
        invoice.requestCancellation(cancellationReason('other')),
        message,
      ),
    ).resolves.toBe(false);
    expect(ctx.persisted).toEqual([]);
    expect(ctx.outbox.enqueue).not.toHaveBeenCalled();
    expect(ctx.usage.settle).not.toHaveBeenCalled();
  });
```

Em `invoice.service.cancel.spec.ts`: o `build` passa a aceitar a nota "gravada" que a releitura devolve e o `lifecycle.transition` resolve `true` por padrão:

```ts
function build(invoice: Invoice, stored?: Invoice) {
  const lifecycle = { transition: jest.fn().mockResolvedValue(true) };
  const webhooks = { publish: jest.fn() };
  const findByIdAndTenantId = jest.fn().mockResolvedValue(invoice);
  if (stored) findByIdAndTenantId.mockResolvedValueOnce(invoice).mockResolvedValue(stored);
  // ... mesmo construtor de hoje, usando { findByIdAndTenantId } no primeiro argumento
  return { service, lifecycle, webhooks };
}
```

e os novos casos:

```ts
  it('publishes the webhook once and returns the stored invoice when a concurrent request won', async () => {
    const invoice = invoiceIn('queued');
    const stored = invoiceIn('cancelled');
    const { service, lifecycle, webhooks } = build(invoice, stored);
    lifecycle.transition.mockResolvedValue(false);
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).resolves.toBe(stored);
    expect(webhooks.publish).not.toHaveBeenCalled();
  });

  it('returns the winner without a webhook when the transition loses the race to another cancel', async () => {
    const invoice = invoiceIn('queued');
    const stored = invoiceIn('cancelled');
    const { service, lifecycle, webhooks } = build(invoice, stored);
    lifecycle.transition.mockRejectedValue(new ConcurrentInvoiceTransitionError(invoice.id));
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).resolves.toBe(stored);
    expect(webhooks.publish).not.toHaveBeenCalled();
  });

  it('answers not-cancellable when the worker took the invoice meanwhile', async () => {
    const invoice = invoiceIn('queued');
    const { service, lifecycle, webhooks } = build(invoice, invoiceIn('processing'));
    lifecycle.transition.mockRejectedValue(new ConcurrentInvoiceTransitionError(invoice.id));
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).rejects.toBeInstanceOf(InvoiceNotCancellableError);
    expect(webhooks.publish).not.toHaveBeenCalled();
  });

  it('rethrows unrelated transition errors', async () => {
    const invoice = invoiceIn('queued');
    const { service, lifecycle } = build(invoice);
    lifecycle.transition.mockRejectedValue(new Error('db down'));
    await expect(
      service.cancel(invoice.id, tenantId, 'test', { reason: 'other' }),
    ).rejects.toThrow('db down');
  });
```

Aproveite para trocar `expect.objectContaining({})` do teste local por `expect.objectContaining({ toStatus: 'cancelled' })` (adaptar ao formato real de `InvoiceEvent`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn jest src/modules/invoice/application/invoice-lifecycle.transition.spec.ts src/modules/invoice/application/invoice.service.cancel.spec.ts`
Expected: FAIL (`transition` resolve `undefined` em vez de `true`/`false`; o webhook é publicado no caso concorrente; o erro de concorrência é propagado em vez de virar o estado do vencedor ou `InvoiceNotCancellableError`).

- [ ] **Step 3: Implementar o retorno booleano**

Em `invoice-lifecycle.service.ts`: `transition(...)` passa a `Promise<boolean>`. Declare `let applied = false;` antes da transação, faça `applied = true;` logo depois do `persistTenantEntity` (antes da lógica live de crédito, que tem `return`s próprios), e devolva `applied` no fim, depois da invalidação do cache. O `return` do caso "status gravado já é o de destino" fica como está (resulta em `false`).

- [ ] **Step 4: Implementar o tratamento no `cancel`**

Em `invoice.service.ts` (importar `ConcurrentInvoiceTransitionError` e `InvoiceNotCancellableError` de `'../domain/errors'`), substituir o trecho entre `requestCancellation` e o `return` por:

```ts
    let applied: boolean;
    try {
      applied = await this.lifecycle.transition(
        invoice,
        event,
        fiscal ? cancellationMessage(invoice, event) : undefined,
      );
    } catch (error: unknown) {
      if (!(error instanceof ConcurrentInvoiceTransitionError)) throw error;
      return this.currentAfterLostRace(id, tenantId, environment);
    }
    if (!applied) return this.currentAfterLostRace(id, tenantId, environment);
    if (!fiscal)
      await this.webhooks.publish(invoice, 'nfse.invoice.cancelled', {
        reason: input.reason,
      });
    return invoice;
  }

  /** Lost a race: another request already cancelled it (return that state) or the worker took it (409). */
  private async currentAfterLostRace(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<Invoice> {
    const current = await this.findById(id, tenantId, environment);
    if (current.status === 'cancelling' || current.status === 'cancelled')
      return current;
    throw new InvoiceNotCancellableError(current.status);
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `yarn jest src/modules/invoice` e depois `yarn typecheck` e `yarn jest`.
Expected: PASS, typecheck limpo, suíte inteira verde.

- [ ] **Step 6: Documentação**

Em `api/FRONTEND_API.md` (seção `POST /invoices/{id}/cancel`) e nas notas do endpoint de `web/lib/docs/content/{en,pt}.ts`: remover `ERROR_CONCURRENT_INVOICE_TRANSITION` da lista de erros do cancelamento e acrescentar uma frase: se outro pedido já cancelou a nota, devolve o estado atual; se a emissão já começou, `409 ERROR_INVOICE_NOT_CANCELLABLE`. Em `web/`, mantenha a paridade en/pt e rode `yarn vitest run tests/docs-parity.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/invoice/application api/FRONTEND_API.md web/lib/docs/content
git commit -m "fix(invoice): publish a single cancelled webhook under concurrent cancels"
```

---

## Emendas pós-revisão final (Tasks 13 a 17)

Decididas depois da revisão final do branch, a partir dos minors diferidos. Spec: seções 5, 8, 9, 10 e 11 (já emendadas). Cada tarefa segue TDD (teste que falha, implementação, teste que passa, suíte inteira). Fora de escopo: recuperação de notas presas em `cancelling` (spec própria futura) e renomear `setRejected`.

### Task 13: Comportamento — erro anterior, e-mail, `requestEmail`, `saveDpsInfo`, log

**Files:**
- Modify: `api/src/modules/invoice/domain/invoice.ts`
- Modify: `api/src/modules/invoice/jobs/nfse-email.processor.ts`
- Modify: `api/src/modules/invoice/application/invoice.service.ts` (`requestEmail`)
- Modify: `api/src/modules/invoice/infra/typeorm-invoice.repository.ts` (`saveDpsInfo`)
- Modify: `api/src/modules/invoice/application/nfse-workflow.service.ts` (log)
- Test: `invoice-cancellation.spec.ts`, `nfse-email.processor.spec.ts`, `invoice.service.spec.ts`, `typeorm-invoice.repository.spec.ts`, `nfse-workflow.cancellation-race.spec.ts`

**Interfaces:** nenhuma nova. Comportamento por spec §5, §8 e §10.

- [ ] **Step 1: Testes que falham**
  1. Domínio: depois de `requestCancellation(fiscal)` + `rejectCancellation('E0840','Prazo expirado')` a nota tem `lastErrorCode='E0840'`; um novo `requestCancellation(fiscal)` deixa `lastErrorCode/Message` nulos; `confirmCancellation()` também os deixa nulos. `rejectCancellation` continua preenchendo.
  2. E-mail processor: para nota `cancelling` e para `cancelled` (com `documentsReadyAt` preenchido) o `process` resolve sem lançar, não chama `getPdf`/`getXml`/envio e não chama `updateEmailStatus`. Para `authorized` sem documentos continua lançando `Invoice documents are not ready`.
  3. `requestEmail`: nota `cancelling`/`cancelled` lança `ConflictException` com mensagem que cita nota cancelada (diferente de `Documents not ready`); nota `authorized` sem `documentsReadyAt` continua com `Documents not ready`.
  4. `saveDpsInfo`: com `dpsId`, `dpsSeries` e `dpsNumber` todos nulos não chama `createQueryBuilder().update()`.
  5. Workflow (spec da corrida): quando `transition` lança `ConcurrentInvoiceTransitionError`, o `logger.debug` é chamado com o id da nota (espionar o logger do serviço).
- [ ] **Step 2:** `yarn jest <os 5 arquivos>` — Expected: FAIL pelos motivos acima.
- [ ] **Step 3: Implementar.** `requestCancellation` (ramo `authorized`) e `confirmCancellation` zeram `lastErrorCode` e `lastErrorMessage` (usar o mesmo mecanismo interno dos setters existentes). Processor: antes do `throw` de documentos não prontos, `if (invoice.status === 'cancelling' || invoice.status === 'cancelled') { this.logger.log(...); return; }` com comentário (o agendador de recuperação reenfileira se a nota voltar a `authorized`). `requestEmail`: ramo próprio para `cancelling`/`cancelled` antes do `Documents not ready`. `saveDpsInfo`: construir o objeto `set` só com campos não nulos e retornar cedo se vazio. Workflow: `this.logger.debug(...)` no `return` do catch.
- [ ] **Step 4:** os mesmos testes passam; `yarn typecheck`; `yarn jest`; eslint `--quiet` nos arquivos alterados.
- [ ] **Step 5: Commit** `fix(invoice): clear stale cancellation errors and skip e-mail for cancelled invoices` (um commit por tema é aceitável).

### Task 14: Contrato — constante única da descrição, OpenAPI, `nfse_list`, `llms.txt`, MCP

**Files:**
- Modify: `api/src/modules/invoice/domain/cancellation-reason.ts`, `api/src/modules/invoice/http/invoice.dto.ts`
- Modify: `api/src/modules/invoice/http/invoice.controller.ts`
- Modify: `api/src/modules/mcp/tools/nfse-cancel.tool.ts`, `api/src/modules/mcp/tools/nfse-list.tool.ts`
- Modify: `api/llms.txt`
- Test: `invoice-cancellation.spec.ts`, `nfse-cancel.tool.spec.ts`, `nfse-list.tool` spec (criar se não houver), spec/contrato OpenAPI existente

- [ ] **Step 1: Testes que falham.** (a) Exportar e testar `CANCELLATION_DESCRIPTION_MIN = 15` e `CANCELLATION_DESCRIPTION_MAX = 255`: fronteiras 14/15 e 255/256 no `assertFiscalCancellationReason`. (b) `NFSE_CANCEL_TOOL.inputSchema.properties.description.maxLength` é `CANCELLATION_DESCRIPTION_MAX`. (c) a descrição do filtro `status` de `NFSE_LIST_TOOL` contém todos os valores de `INVOICE_STATUSES` (inclui `cancelling` e `cancelled`). (d) O documento OpenAPI gerado para `POST /v1/invoices/{id}/cancel` tem respostas `200` e `202` (usar o spec de OpenAPI existente como modelo). (e) `llms.txt` contém `ERROR_INVOICE_NOT_CANCELLABLE` e `ERROR_INVALID_CANCELLATION_REASON` (teste simples de leitura de arquivo, se houver precedente; senão, apenas conferir manualmente e registrar).
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3: Implementar.** Constantes em `cancellation-reason.ts` usadas em `assertFiscalCancellationReason`, `@MaxLength` do DTO e `maxLength` do `inputSchema`. `@ApiOkResponse` e `@ApiAcceptedResponse` (DTO de resposta da invoice, mesmo usado pelos vizinhos) no `cancel`. Descrição do `nfse_list` montada com `INVOICE_STATUSES.join(', ')`. `llms.txt`: acrescentar os dois códigos de erro ao parágrafo de cancelamento.
- [ ] **Step 4:** testes verdes; `yarn typecheck`; `yarn jest`; eslint `--quiet`.
- [ ] **Step 5: Commit** `refactor(invoice): single source for the cancellation description rule and complete the contract docs`.

### Task 15: Dashboard — reset do modal e predicado de visibilidade

**Files:**
- Modify: `web/lib/invoice-cancellation.ts`, `web/app/app/invoices/[id]/page.tsx`, `web/components/dashboard/cancel-invoice-dialog.tsx`
- Test: `web/tests/invoice-cancellation.test.ts` (existente do helper; estender) e `web/tests/cancel-invoice-dialog.test.tsx`

- [ ] **Step 1: Testes que falham.** (a) `canCancelInvoice(status, hasPermission)`: `true` só para `queued`/`authorized` com permissão; `false` para os demais status e sem permissão. (b) Constantes `CANCELLATION_DESCRIPTION_MIN/MAX` (15/255) exportadas pelo helper e usadas pelo diálogo; teste de fronteira 14/15/255/256 na validação do diálogo (o caso de 256 é barrado por `maxLength` do `textarea`; testar 14 e 15 e o botão). (c) Reabrir: renderizar o diálogo com `open`, digitar motivo/descrição e provocar erro; desmontar/remontar (como a página faz com `{open && ...}`) e verificar campos vazios e sem alerta.
- [ ] **Step 2:** `yarn vitest run tests/invoice-cancellation.test.ts tests/cancel-invoice-dialog.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implementar.** Predicado e constantes em `web/lib/invoice-cancellation.ts`; a página usa `canCancelInvoice(invoice.status, can("nfse.invoices.issue"))` e monta o diálogo com `{cancelOpen && <CancelInvoiceDialog … />}`; o diálogo importa as constantes em vez de literais.
- [ ] **Step 4:** `yarn vitest run`, `yarn lint`, `yarn tsc --noEmit` na `web/`.
- [ ] **Step 5: Commit** `fix(web): reset the cancel dialog on reopen and test button visibility`.

### Task 16: Cobertura adicional (só testes)

**Files (apenas specs):** `invoice-webhook.publisher.spec.ts`, `open-nfse.provider.cancel.spec.ts`, `nfse-cancellation.service.spec.ts`

- [ ] **Step 1: Testes** (devem passar de primeira; provar com mutação onde indicado). (a) Publisher: `publish(invoice, 'nfse.invoice.email_sent', {}, { emailStatus: 'sent' })` coloca `emailStatus: 'sent'` no payload mesmo com `lastEmailStatus` diferente na nota. (b) Provider: replay `failed_permanent` retorna `rejected` com código e mensagem; replay `still_pending` e lista vazia retornam `pending` (mensagens `still_pending` e `Awaiting fiscal retry window`); `ValidationError` mapeia para `INVALID_FISCAL_INPUT`; `client.close` é chamado em sucesso e em exceção. (c) Serviço de cancelamento: caracterização do risco da spec §11. Quando `provider.cancel` devolve `cancelled` e `lifecycle.transition` lança, o `process` rejeita (o job é tentado de novo) e `webhooks.publish` não é chamado. O teste documenta, em comentário, que o reenvio ao Sefin é o risco aceito.
- [ ] **Step 2:** mutações: remover o `finally { client.close() }` faz (b) falhar; fazer o publisher ignorar `stateOverride` faz (a) falhar. Reverter.
- [ ] **Step 3:** `yarn jest`, eslint `--quiet` nos specs.
- [ ] **Step 4: Commit** `test(nfse): cover provider replay branches, state override and the accepted-then-failed cancellation`.

### Task 17: Operação — `down` da migration e ordem de deploy

**Files:**
- Modify: `api/src/infra/database/migrations/1792400000000-AddInvoiceCancellation.ts`
- Modify: `SELF_HOSTING.md`
- Test: `api/src/infra/database/migrations/` (spec unitário com `QueryRunner` falso, ao lado do arquivo; os specs Postgres seguem pulados sem `MIGRATION_TEST_DATABASE_URL`)

- [ ] **Step 1: Teste que falha.** `down` com um `QueryRunner` falso cuja consulta de contagem devolve `> 0` lança erro com mensagem clara (cita `cancelling`/`cancelled` e a quantidade) e não executa nenhum `ALTER TABLE`; com contagem `0` executa as três etapas atuais na ordem.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3: Implementar.** No início do `down`: `SELECT count(*)::int AS total FROM ${schema}.nfse_invoices WHERE status IN ('cancelling','cancelled')`; se `total > 0`, `throw new Error(...)`. Comentário no topo explicando por que não mapear para `authorized`.
- [ ] **Step 4:** teste verde; `yarn typecheck`; `yarn jest`; eslint `--quiet`.
- [ ] **Step 5: Docs.** `SELF_HOSTING.md`: seção curta de atualização com a ordem de deploy (worker antes da API, por causa da mensagem de outbox `invoice.cancel`) e o aviso do `down`.
- [ ] **Step 6: Commit** `fix(db): make the cancellation migration rollback fail with a clear message` e `docs: document the deploy order for invoice cancellation`.
