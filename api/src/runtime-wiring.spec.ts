import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduleModule } from '@nestjs/schedule';
import { AppModule } from './app.module';
import { WorkerAppModule } from './worker-app.module';
import { EventProcessorScheduler } from './modules/integrations/jobs/event-processor.scheduler';
import { IntegrationsModule } from './modules/integrations/integrations.module';

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
});
