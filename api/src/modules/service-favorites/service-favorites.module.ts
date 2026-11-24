import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyModule } from '@/modules/company/company.module';
import { ServiceFavoritesService } from './application/service-favorites.service';
import { IServiceFavoriteRepository } from './domain/service-favorite';
import { ServiceFavoritesController } from './http/service-favorites.controller';
import { ServiceFavoriteOrmEntity } from './infra/service-favorite.orm-entity';
import { TypeOrmServiceFavoriteRepository } from './infra/typeorm-service-favorite.repository';

@Module({
  imports: [
    CompanyModule,
    TypeOrmModule.forFeature([ServiceFavoriteOrmEntity]),
  ],
  controllers: [ServiceFavoritesController],
  providers: [
    ServiceFavoritesService,
    {
      provide: IServiceFavoriteRepository,
      useClass: TypeOrmServiceFavoriteRepository,
    },
  ],
})
export class ServiceFavoritesModule {}
