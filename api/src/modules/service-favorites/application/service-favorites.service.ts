import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IServiceFavoriteRepository } from '../domain/service-favorite';
import type {
  FavoriteKind,
  NewServiceFavorite,
  ServiceFavorite,
} from '../domain/service-favorite';

export const MAX_FAVORITES_PER_COMPANY = 50;
export const MAX_PRODUCTS_PER_COMPANY = 500;

@Injectable()
export class ServiceFavoritesService {
  constructor(private readonly favorites: IServiceFavoriteRepository) {}

  list(
    companyId: string,
    tenantId: string,
    kind: FavoriteKind = 'service',
  ): Promise<ServiceFavorite[]> {
    return this.favorites.list(companyId, tenantId, kind);
  }

  async create(
    companyId: string,
    tenantId: string,
    input: NewServiceFavorite,
  ): Promise<ServiceFavorite> {
    const kind = input.kind ?? 'service';
    const existing = await this.favorites.list(companyId, tenantId, kind);
    if (kind === 'product') {
      // The same description updates the saved product, so it never counts as a new one.
      const key = input.description.toLowerCase();
      const isNew = !existing.some((p) => p.description.toLowerCase() === key);
      if (isNew && existing.length >= MAX_PRODUCTS_PER_COMPANY)
        throw new ConflictException({
          code: 'PRODUCT_FAVORITES_LIMIT',
          message: `A company can have up to ${MAX_PRODUCTS_PER_COMPANY} saved products`,
        });
    } else if (existing.length >= MAX_FAVORITES_PER_COMPANY)
      throw new ConflictException({
        code: 'SERVICE_FAVORITES_LIMIT',
        message: `A company can have up to ${MAX_FAVORITES_PER_COMPANY} favorite services`,
      });
    return this.favorites.create(companyId, tenantId, input);
  }

  async delete(id: string, companyId: string, tenantId: string): Promise<void> {
    const removed = await this.favorites.delete(id, companyId, tenantId);
    if (!removed)
      throw new NotFoundException({
        code: 'SERVICE_FAVORITE_NOT_FOUND',
        message: 'Favorite not found',
      });
  }
}
