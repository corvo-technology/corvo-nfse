import { RlsConnectionScopeService } from './rls-connection-scope.service';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseConfig } from '@/infra/config/configuration';
import { createNestTypeOrmOptions } from './typeorm.options';
import { PostgresPoolTelemetryService } from './postgres-pool-telemetry.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const database = configService.getOrThrow<DatabaseConfig>('database');

        return createNestTypeOrmOptions(database);
      },
    }),
  ],
  providers: [PostgresPoolTelemetryService, RlsConnectionScopeService],
  exports: [TypeOrmModule],
})
export class AppDatabaseModule {}
