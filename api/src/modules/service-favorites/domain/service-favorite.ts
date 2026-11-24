export interface ServiceFavorite {
  id: string;
  tenantId: string;
  companyId: string;
  label: string;
  description: string;
  serviceCode: string;
  /** Default amount in cents, when the service always costs the same. */
  amountCents: number | null;
  municipalityCode: string | null;
  createdAt: Date;
}

export type NewServiceFavorite = Omit<
  ServiceFavorite,
  'id' | 'tenantId' | 'companyId' | 'createdAt'
>;

export abstract class IServiceFavoriteRepository {
  abstract list(
    companyId: string,
    tenantId: string,
  ): Promise<ServiceFavorite[]>;
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
