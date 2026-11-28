/** A favorite is a service (to fill the NFS-e) or a product (to fill the NF-e and NFC-e items). */
export type FavoriteKind = 'service' | 'product';

export interface ServiceFavorite {
  id: string;
  tenantId: string;
  companyId: string;
  kind: FavoriteKind;
  /** Short name; on a product it is the start of the description. */
  label: string;
  description: string;
  /** cTribNac; only on a service. */
  serviceCode: string | null;
  /** Default amount in cents, when the service always costs the same. */
  amountCents: number | null;
  municipalityCode: string | null;
  /** Product fields (null on a service). */
  code: string | null;
  gtin: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unit: string | null;
  /** Price of one unit, in reais. */
  unitPrice: number | null;
  /** 102 or 400; null follows the company. */
  csosn: string | null;
  origin: number | null;
  createdAt: Date;
}

/** What is saved; a service leaves the product fields out and the other way round. */
export interface NewServiceFavorite {
  kind?: FavoriteKind;
  label: string;
  description: string;
  serviceCode?: string | null;
  amountCents?: number | null;
  municipalityCode?: string | null;
  code?: string | null;
  gtin?: string | null;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  unit?: string | null;
  unitPrice?: number | null;
  csosn?: string | null;
  origin?: number | null;
}

export abstract class IServiceFavoriteRepository {
  abstract list(
    companyId: string,
    tenantId: string,
    kind?: FavoriteKind,
  ): Promise<ServiceFavorite[]>;
  /** A product with the same description (any case) in the company is updated instead of repeated. */
  abstract create(
    companyId: string,
    tenantId: string,
    input: NewServiceFavorite,
  ): Promise<ServiceFavorite>;
  /** Returns false when the favorite does not exist for this tenant and company. */
  abstract delete(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<boolean>;
}
