import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IServiceFavoriteRepository } from '../domain/service-favorite';
import type {
  NewServiceFavorite,
  ServiceFavorite,
} from '../domain/service-favorite';

export const MAX_FAVORITES_PER_COMPANY = 50;

@Injectable()
export class ServiceFavoritesService {
  constructor(private readonly favorites: IServiceFavoriteRepository) {}

  list(companyId: string, tenantId: string): Promise<ServiceFavorite[]> {
    return this.favorites.list(companyId, tenantId);
  }

  async create(
    companyId: string,
    tenantId: string,
    input: NewServiceFavorite,
  ): Promise<ServiceFavorite> {
    const existing = await this.favorites.list(companyId, tenantId);
    if (existing.length >= MAX_FAVORITES_PER_COMPANY)
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
        message: 'Service favorite not found',
      });
  }
}
