import { ConflictException, NotFoundException } from '@nestjs/common';
import type {
  IServiceFavoriteRepository,
  ServiceFavorite,
} from '../domain/service-favorite';
import {
  MAX_FAVORITES_PER_COMPANY,
  ServiceFavoritesService,
} from './service-favorites.service';

const favorite = (n: number): ServiceFavorite => ({
  id: `id-${n}`,
  tenantId: 't',
  companyId: 'c',
  label: `Servico ${n}`,
  description: 'Mensalidade',
  serviceCode: '010101',
  amountCents: 15000,
  municipalityCode: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

describe('ServiceFavoritesService', () => {
  const input = {
    label: 'Mensalidade',
    description: 'Consultoria mensal',
    serviceCode: '010101',
    amountCents: null,
    municipalityCode: null,
  };

  function build(existing: ServiceFavorite[], removed = true) {
    const repo = {
      list: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(favorite(99)),
      delete: jest.fn().mockResolvedValue(removed),
    } as unknown as jest.Mocked<IServiceFavoriteRepository>;
    return { repo, service: new ServiceFavoritesService(repo) };
  }

  it('creates a favorite for the company', async () => {
    const { repo, service } = build([]);
    await expect(service.create('c', 't', input)).resolves.toEqual(
      favorite(99),
    );
    expect(repo.create).toHaveBeenCalledWith('c', 't', input);
  });

  it('refuses more favorites than the limit', async () => {
    const full = Array.from({ length: MAX_FAVORITES_PER_COMPANY }, (_, n) =>
      favorite(n),
    );
    const { repo, service } = build(full);
    await expect(service.create('c', 't', input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('answers 404 when the favorite is not found for this tenant', async () => {
    const { service } = build([], false);
    await expect(service.delete('x', 'c', 't')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes within tenant and company', async () => {
    const { repo, service } = build([]);
    await service.delete('x', 'c', 't');
    expect(repo.delete).toHaveBeenCalledWith('x', 'c', 't');
  });
});
