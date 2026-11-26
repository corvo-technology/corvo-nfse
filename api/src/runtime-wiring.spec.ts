import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduleModule } from '@nestjs/schedule';
import { AppModule } from './app.module';
import { WorkerAppModule } from './worker-app.module';
import { EventProcessorScheduler } from './modules/integrations/jobs/event-processor.scheduler';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { WooviConnectorModule } from './modules/integrations/connectors/woovi/woovi.module';
import { AbacatePayConnectorModule } from './modules/integrations/connectors/abacatepay/abacatepay.module';
import { PushinPayConnectorModule } from './modules/integrations/connectors/pushinpay/pushinpay.module';
import { StripeConnectorModule } from './modules/integrations/connectors/stripe/stripe.module';

function importedModules(moduleClass: object): unknown[] {
  const imports =
    (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) as unknown[]) ??
    [];
  return imports.map((value) =>
    typeof value === 'object' && value !== null && 'module' in value
      ? value.module
      : value,
  );
}

describe('runtime wiring', () => {
  it('lets only the worker run scheduled jobs', () => {
    expect(importedModules(AppModule)).not.toContain(ScheduleModule);
    expect(importedModules(WorkerAppModule)).toContain(ScheduleModule);
  });

  it('processes integration events only in the worker, and both processes load the module', () => {
    const providers = (module: object) =>
      (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) as unknown[]) ??
      [];
    expect(providers(WorkerAppModule)).toContain(EventProcessorScheduler);
    expect(providers(AppModule)).not.toContain(EventProcessorScheduler);
    expect(importedModules(AppModule)).toContain(IntegrationsModule);
    expect(importedModules(WorkerAppModule)).toContain(IntegrationsModule);
  });

  it('loads the Woovi, AbacatePay and Stripe connectors in both processes, so the worker can normalize what the API stored', () => {
    expect(importedModules(AppModule)).toContain(WooviConnectorModule);
    expect(importedModules(WorkerAppModule)).toContain(WooviConnectorModule);
    expect(importedModules(AppModule)).toContain(AbacatePayConnectorModule);
    expect(importedModules(WorkerAppModule)).toContain(
      AbacatePayConnectorModule,
    );
    expect(importedModules(AppModule)).toContain(StripeConnectorModule);
    expect(importedModules(WorkerAppModule)).toContain(StripeConnectorModule);
  });

  it('loads the PushinPay connector in both processes', () => {
    expect(importedModules(AppModule)).toContain(PushinPayConnectorModule);
    expect(importedModules(WorkerAppModule)).toContain(
      PushinPayConnectorModule,
    );
  });
});
