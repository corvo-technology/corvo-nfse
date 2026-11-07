export interface IntegrationRule {
  id: string;
  tenantId: string;
  connectionId: string;
  /** Null marks the connection's default rule. */
  externalProductId: string | null;
  /** Same shape as the invoice API's `service` object. */
  service: Record<string, unknown>;
  sendEmail: boolean;
  allowAnonymousCustomer: boolean;
  /** When the platform reports a refund after the invoice was issued, ask for the invoice to be cancelled. */
  cancelOnRefund: boolean;
}

import type { NormalizedOperation } from './connector';

export type RuleSelection =
  { rule: IntegrationRule } | { error: 'no_rule' | 'ambiguous_rule' };

/**
 * A product with its own rule uses it; any other product (or an operation
 * with no known product) falls back to the connection's default rule.
 * Items that resolve to different rules cannot be issued automatically.
 */
export function selectRule(
  rules: IntegrationRule[],
  items: NormalizedOperation['items'],
): RuleSelection {
  const fallback = rules.find((r) => r.externalProductId === null);
  const products = [
    ...new Set(
      items.flatMap((i) => (i.externalProductId ? [i.externalProductId] : [])),
    ),
  ];
  const resolved =
    products.length === 0
      ? [fallback]
      : products.map(
          (p) => rules.find((r) => r.externalProductId === p) ?? fallback,
        );
  if (resolved.some((r) => r === undefined)) return { error: 'no_rule' };
  const distinct = new Set(resolved.map((r) => r!.id));
  if (distinct.size > 1) return { error: 'ambiguous_rule' };
  return { rule: resolved[0]! };
}
