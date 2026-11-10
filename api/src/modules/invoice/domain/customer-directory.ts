import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/** A customer (tomador) remembered from an accepted invoice, so the next one needs only the CPF/CNPJ. */
export interface SavedCustomer {
  /** CPF (11) or CNPJ (14), without punctuation. */
  taxId: string;
  name: string;
  email: string | null;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerScope {
  tenantId: string;
  environment: ExecutionEnvironment;
}

export interface CustomerListFilter {
  /** Matches the name (any part, case-insensitive) or the start of the document. */
  search?: string;
}

export interface CustomerListResult {
  items: SavedCustomer[];
  total: number;
}

/** DPS `xNome` (TSNomeRazaoSocial) holds up to 300 characters. */
export const CUSTOMER_NAME_MAX = 300;

/**
 * Customers saved per workspace and environment. One row per document; `test` and `live`
 * never mix, and neither do workspaces (PostgreSQL row level security).
 */
export abstract class CustomerDirectory {
  abstract find(
    scope: CustomerScope,
    taxId: string,
  ): Promise<SavedCustomer | null>;

  /**
   * Saves or refreshes the customer of an accepted invoice. The name always follows the
   * latest invoice; an email already saved is kept when the invoice carries none.
   */
  abstract remember(
    scope: CustomerScope,
    customer: { taxId: string; name: string; email?: string | null },
  ): Promise<void>;

  abstract list(
    scope: CustomerScope,
    filter: CustomerListFilter,
    page: { limit: number; offset: number },
  ): Promise<CustomerListResult>;

  /** Changes only the fields sent. Returns null when the customer does not exist. */
  abstract update(
    scope: CustomerScope,
    taxId: string,
    change: { name?: string; email?: string | null },
  ): Promise<SavedCustomer | null>;

  /** Removes the saved customer; issued invoices are not touched. */
  abstract remove(scope: CustomerScope, taxId: string): Promise<boolean>;
}
