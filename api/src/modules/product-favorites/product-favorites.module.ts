import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyModule } from '@/modules/company/company.module';
import { ProductFavoritesService } from './application/product-favorites.service';
import { IProductFavoriteRepository } from './domain/product-favorite';
import { ProductFavoritesController } from './http/product-favorites.controller';
import { ProductFavoriteOrmEntity } from './infra/product-favorite.orm-entity';
import { TypeOrmProductFavoriteRepository } from './infra/typeorm-product-favorite.repository';

@Module({
  imports: [
    CompanyModule,
    TypeOrmModule.forFeature([ProductFavoriteOrmEntity]),
  ],
  controllers: [ProductFavoritesController],
  providers: [
    ProductFavoritesService,
    {
      provide: IProductFavoriteRepository,
      useClass: TypeOrmProductFavoriteRepository,
    },
  ],
  exports: [ProductFavoritesService],
})
export class ProductFavoritesModule {}
