import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/** Address of a customer, as the NF-e recipient needs it. `cityCode` is the IBGE code (7 digits). */
export interface CustomerAddress {
  street: string;
  number: string;
  complement: string | null;
  district: string;
  zip: string;
  cityCode: string;
  city: string;
  state: string;
}

/** The NF-e recipient data a saved customer keeps (all optional: an NFS-e customer has none). */
export interface CustomerNfeData {
  address?: CustomerAddress | null;
  /** 1 contributor, 2 exempt, 9 non-contributor. */
  indIeDest?: 1 | 2 | 9 | null;
  stateRegistration?: string | null;
}

/** A customer (tomador) remembered from an accepted invoice, so the next one needs only the CPF/CNPJ. */
export interface SavedCustomer {
  /** CPF (11) or CNPJ (14), without punctuation. */
  taxId: string;
  name: string;
  email: string | null;
  address: CustomerAddress | null;
  indIeDest: 1 | 2 | 9 | null;
  stateRegistration: string | null;
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
   * Saves the customer of an accepted invoice. Automatic sources (invoices, imports,
   * schedules, integrations) only create the customer or fill an empty field: a saved name,
   * email, address or state registration is never replaced. Only `update` (an explicit edit) changes existing values.
   */
  abstract remember(
    scope: CustomerScope,
    customer: {
      taxId: string;
      name: string;
      email?: string | null;
    } & CustomerNfeData,
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
    change: { name?: string; email?: string | null } & CustomerNfeData,
  ): Promise<SavedCustomer | null>;

  /** Removes the saved customer; issued invoices are not touched. */
  abstract remove(scope: CustomerScope, taxId: string): Promise<boolean>;
}
