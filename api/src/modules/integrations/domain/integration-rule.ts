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
}
