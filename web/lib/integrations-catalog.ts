/**
 * Platforms shown on the public integrations page, by group. The facts on each card (events,
 * cancellations, how the webhook is checked) live in messages/*.json under IntegrationsPage.platforms
 * and come from the connectors in api/src/modules/integrations/connectors.
 */
export const INTEGRATION_GROUPS = ["pay", "info"] as const;
export type IntegrationGroup = (typeof INTEGRATION_GROUPS)[number];

export interface IntegrationPlatform {
  id: string;
  name: string;
  /** One or two letters on the card badge. */
  initial: string;
  group: IntegrationGroup;
}

export const INTEGRATION_PLATFORMS: readonly IntegrationPlatform[] = [
  { id: "mercadopago", name: "Mercado Pago", initial: "MP", group: "pay" },
  { id: "stripe", name: "Stripe", initial: "S", group: "pay" },
  { id: "asaas", name: "Asaas", initial: "A", group: "pay" },
  { id: "pagarme", name: "Pagar.me", initial: "P", group: "pay" },
  { id: "woovi", name: "Woovi", initial: "W", group: "pay" },
  { id: "abacatepay", name: "AbacatePay", initial: "Ab", group: "pay" },
  { id: "pushinpay", name: "PushinPay", initial: "Pu", group: "pay" },
  { id: "hotmart", name: "Hotmart", initial: "H", group: "info" },
  { id: "kiwify", name: "Kiwify", initial: "K", group: "info" },
  { id: "eduzz", name: "Eduzz", initial: "E", group: "info" },
  { id: "monetizze", name: "Monetizze", initial: "Mo", group: "info" },
];
