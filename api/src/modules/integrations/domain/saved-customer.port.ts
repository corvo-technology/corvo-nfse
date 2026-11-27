import type { IntegrationEnvironment } from './connector';

/** What the workspace already knows about a customer (from earlier invoices or the customers screen). */
export interface KnownCustomer {
  name: string;
  email: string | null;
}

/** The only way the integrations module asks the customers module about a CPF/CNPJ. */
export abstract class SavedCustomerPort {
  abstract find(
    tenantId: string,
    environment: IntegrationEnvironment,
    taxId: string,
  ): Promise<KnownCustomer | null>;
}

/** A name of up to two characters is a typing slip or a placeholder, not a name. */
const MIN_NAME = 3;

/**
 * The customer of a sale completed with what the workspace already knows: what the
 * platform sent wins when it is usable; the saved e-mail and a missing or obviously
 * incomplete name are filled in. Nothing is ever written back from here.
 */
export function completeFromSaved<
  C extends { name: string | null; email: string | null },
>(customer: C, saved: KnownCustomer): C {
  const sentName = customer.name?.trim() ?? '';
  return {
    ...customer,
    name: sentName.length >= MIN_NAME ? customer.name : saved.name,
    email: customer.email?.trim() ? customer.email : saved.email,
  };
}
