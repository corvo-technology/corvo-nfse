import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduleModule } from '@nestjs/schedule';
import { AppModule } from './app.module';
import { WorkerAppModule } from './worker-app.module';

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
});
