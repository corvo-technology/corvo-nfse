import { createHash } from 'node:crypto';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import { canonicalJson } from './canonical-json';
import type { IntegrationEnvironment, NormalizedOperation } from './connector';
import type { ConnectionState } from './integration-connection';
import type { BlockReason } from './integration-operation';
import { selectRule, type IntegrationRule } from './integration-rule';

export interface PlanInput {
  tenantId: string;
  provider: string;
  connection: {
    id: string;
    companyId: string;
    state: ConnectionState;
    activeFrom: Date | null;
    environment: IntegrationEnvironment;
    externalAccountId: string;
  };
  operation: {
    snapshot: NormalizedOperation;
    commercialState: NormalizedOperation['commercialState'];
  };
  rules: IntegrationRule[];
}

export type EmissionPlan =
  | {
      kind: 'issue';
      ruleId: string;
      request: CreateInvoiceDto;
      requestHash: string;
      idempotencyKey: string;
    }
  | { kind: 'blocked'; reason: BlockReason }
  | { kind: 'needs_attention'; reason: BlockReason };

export function idempotencyKeyFor(input: {
  tenantId: string;
  environment: IntegrationEnvironment;
  provider: string;
  externalAccountId: string;
  operationKey: string;
}): string {
  const identity = [
    input.tenantId,
    input.environment,
    input.provider,
    input.externalAccountId,
    input.operationKey,
  ].join('|');
  return `integ_${createHash('sha256').update(identity).digest('hex')}`;
}

const blocked = (reason: BlockReason): EmissionPlan => ({
  kind: 'blocked',
  reason,
});
const attention = (reason: BlockReason): EmissionPlan => ({
  kind: 'needs_attention',
  reason,
});

const COMMERCIAL_BLOCK: Record<string, BlockReason> = {
  refunded: 'refunded',
  disputed: 'disputed',
  pending: 'not_paid',
  canceled: 'not_paid',
};

/** First failing check wins; the order follows the spec (section 6). */
export function planEmission(input: PlanInput): EmissionPlan {
  const { connection, operation, rules } = input;
  const snap = operation.snapshot;
  const paidAt = snap.paidAt ?? snap.occurredAt;

  if (connection.state !== 'active') return blocked('connection_inactive');
  if (connection.activeFrom && paidAt < connection.activeFrom)
    return blocked('before_active_from');
  if (operation.commercialState !== 'paid')
    return blocked(COMMERCIAL_BLOCK[operation.commercialState]);
  if (snap.currency !== 'BRL') return blocked('unsupported_currency');
  if (!Number.isInteger(snap.amountCents) || snap.amountCents <= 0)
    return blocked('invalid_amount');
  if (!snap.sellerIssuesInvoice) return blocked('seller_not_issuer');

  const selection = selectRule(rules, snap.items);
  if ('error' in selection) return attention(selection.error);
  const { rule } = selection;

  const customer = usableCustomer(snap.customer);
  if (!customer && !rule.allowAnonymousCustomer)
    return attention('customer_tax_id_missing');

  const request: CreateInvoiceDto = {
    companyId: connection.companyId,
    ...(customer ? { customer } : {}),
    service: serviceFor(rule, snap),
    amount: toReais(snap.amountCents),
    ...(snap.discountCents > 0
      ? { discount: toReais(snap.discountCents) }
      : {}),
    competenceDate: saoPauloDate(paidAt),
    // A paid sale is never held back for a missing e-mail: without an address, no e-mail goes out.
    email:
      (snap.sendEmailOverride ?? rule.sendEmail) && Boolean(customer?.email),
    externalId: snap.operationKey.slice(0, 100),
  };
  return {
    kind: 'issue',
    ruleId: rule.id,
    request,
    requestHash: createHash('sha256')
      .update(canonicalJson(request))
      .digest('hex'),
    idempotencyKey: idempotencyKeyFor({
      tenantId: input.tenantId,
      environment: connection.environment,
      provider: input.provider,
      externalAccountId: connection.externalAccountId,
      operationKey: snap.operationKey,
    }),
  };
}

const MAX_DESCRIPTION = 200;

/** The rule's own description wins; otherwise what the platform says was sold; otherwise the company default. */
function serviceFor(
  rule: IntegrationRule,
  snap: NormalizedOperation,
): CreateInvoiceDto['service'] {
  const sold = snap.description?.trim().slice(0, MAX_DESCRIPTION);
  const override = snap.serviceOverride;
  const base = {
    ...rule.service,
    ...(override?.code ? { code: override.code } : {}),
  };
  if (override?.description)
    return { ...base, description: override.description };
  if (rule.service.description || !sold) return base;
  return { ...base, description: sold };
}

function usableCustomer(
  customer: NormalizedOperation['customer'],
): CreateInvoiceDto['customer'] | null {
  if (
    !customer ||
    customer.taxIdMasked ||
    !customer.taxId ||
    !/^([0-9]{11}|[0-9A-Z]{14})$/.test(customer.taxId)
  )
    return null;
  return {
    ...(customer.name ? { name: customer.name } : {}),
    taxId: customer.taxId,
    ...(customer.email ? { email: customer.email } : {}),
    ...(customer.address && Object.keys(customer.address).length > 0
      ? { address: customer.address }
      : {}),
  };
}

const toReais = (cents: number): number => Number((cents / 100).toFixed(2));

function saoPauloDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}
