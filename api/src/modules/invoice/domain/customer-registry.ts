/** What the public CNPJ registry says about a company that may become a customer (tomador). */
export interface CustomerRegistryInfo {
  /** Razão social. */
  name: string;
  city: string | null;
  /** Two-letter state (UF). */
  state: string | null;
}

/** Public registry used to prefill a new customer. The email is never taken from it: it is unreliable. */
export abstract class CustomerRegistryPort {
  /** Null when the registry is unavailable, slow or does not know the CNPJ. Never throws. */
  abstract lookup(cnpj: string): Promise<CustomerRegistryInfo | null>;
}
