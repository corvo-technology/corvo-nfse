import { MODULE_METADATA } from '@nestjs/common/constants';
import { InvoiceModule } from './invoice.module';
import { WorkerAppModule } from '@/worker-app.module';
import { AppModule } from '@/app.module';
import { OutboxService } from './application/outbox.service';
import { OutboxHandlerRegistry } from './application/outbox-handler.registry';
import { OutboxRelay } from './application/outbox-relay';
import { OUTBOX_REPOSITORY } from './domain/outbox.repository';
import { TypeOrmOutboxRepository } from './infra/typeorm-outbox.repository';
import { OutboxMessageOrmEntity } from './infra/outbox-message.orm-entity';

const metadata = (key: string, moduleClass: object): unknown[] =>
  (Reflect.getMetadata(key, moduleClass) as unknown[] | undefined) ?? [];

describe('invoice outbox ownership', () => {
  it('owns service, registry, repository and entity in InvoiceModule', () => {
    expect(metadata(MODULE_METADATA.PROVIDERS, InvoiceModule)).toEqual(
      expect.arrayContaining([
        OutboxService,
        OutboxHandlerRegistry,
        { provide: OUTBOX_REPOSITORY, useClass: TypeOrmOutboxRepository },
      ]),
    );
    expect(metadata(MODULE_METADATA.EXPORTS, InvoiceModule)).toEqual(
      expect.arrayContaining([OutboxHandlerRegistry, OUTBOX_REPOSITORY]),
    );
    const entityProviders = metadata(
      MODULE_METADATA.IMPORTS,
      InvoiceModule,
    ).flatMap((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('providers' in entry) ||
        !Array.isArray(entry.providers)
      )
        return [];
      return entry.providers as unknown[];
    });
    expect(entityProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: `${OutboxMessageOrmEntity.name}Repository`,
        }),
      ]),
    );
  });
  it('runs relay only as a WorkerAppModule provider', () => {
    expect(metadata(MODULE_METADATA.PROVIDERS, WorkerAppModule)).toContain(
      OutboxRelay,
    );
    expect(metadata(MODULE_METADATA.PROVIDERS, InvoiceModule)).not.toContain(
      OutboxRelay,
    );
    expect(metadata(MODULE_METADATA.PROVIDERS, AppModule)).not.toContain(
      OutboxRelay,
    );
    expect(metadata(MODULE_METADATA.EXPORTS, InvoiceModule)).not.toContain(
      OutboxRelay,
    );
  });
});
