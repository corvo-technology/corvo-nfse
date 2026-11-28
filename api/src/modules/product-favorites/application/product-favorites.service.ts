import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IProductFavoriteRepository } from '../domain/product-favorite';
import type {
  NewProductFavorite,
  ProductFavorite,
} from '../domain/product-favorite';

export const MAX_PRODUCTS_PER_COMPANY = 500;

@Injectable()
export class ProductFavoritesService {
  constructor(private readonly products: IProductFavoriteRepository) {}

  list(companyId: string, tenantId: string): Promise<ProductFavorite[]> {
    return this.products.list(companyId, tenantId);
  }

  /** Saves a product; the same description (any case) updates the one already saved. */
  async save(
    companyId: string,
    tenantId: string,
    input: NewProductFavorite,
  ): Promise<ProductFavorite> {
    const existing = await this.products.list(companyId, tenantId);
    const key = input.description.toLowerCase();
    const isNew = !existing.some((p) => p.description.toLowerCase() === key);
    if (isNew && existing.length >= MAX_PRODUCTS_PER_COMPANY)
      throw new ConflictException({
        code: 'PRODUCT_FAVORITES_LIMIT',
        message: `A company can have up to ${MAX_PRODUCTS_PER_COMPANY} saved products`,
      });
    return this.products.save(companyId, tenantId, input);
  }

  async delete(id: string, companyId: string, tenantId: string): Promise<void> {
    const removed = await this.products.delete(id, companyId, tenantId);
    if (!removed)
      throw new NotFoundException({
        code: 'PRODUCT_FAVORITE_NOT_FOUND',
        message: 'Saved product not found',
      });
  }
}
