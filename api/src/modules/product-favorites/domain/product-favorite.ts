export interface ProductFavorite {
  id: string;
  tenantId: string;
  companyId: string;
  /** Product name as it is printed on the note (xProd). */
  description: string;
  code: string;
  gtin: string | null;
  ncm: string;
  cest: string | null;
  /** Default CFOP; the form may replace it by the one that fits the recipient. */
  cfop: string | null;
  unit: string;
  unitPrice: number;
  /** 102 or 400; null follows the company. */
  csosn: string | null;
  origin: number | null;
  createdAt: Date;
}

export type NewProductFavorite = Omit<
  ProductFavorite,
  'id' | 'tenantId' | 'companyId' | 'createdAt'
>;

export abstract class IProductFavoriteRepository {
  abstract list(
    companyId: string,
    tenantId: string,
  ): Promise<ProductFavorite[]>;
  /** The same description (any case) in the same company updates the product instead of repeating it. */
  abstract save(
    companyId: string,
    tenantId: string,
    input: NewProductFavorite,
  ): Promise<ProductFavorite>;
  /** Returns false when the product does not exist for this tenant and company. */
  abstract delete(
    id: string,
    companyId: string,
    tenantId: string,
  ): Promise<boolean>;
}
