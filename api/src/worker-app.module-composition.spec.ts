/* eslint-disable @typescript-eslint/no-unsafe-argument,@typescript-eslint/no-require-imports */
import { MODULE_METADATA } from '@nestjs/common/constants';

describe('WorkerAppModule composition', () => {
  it('does not leave undefined imports while loading the worker dependency graph', () => {
    jest.isolateModules(() => {
      require('./worker-app.module');

      const { AuthModule } = require('./modules/auth/auth.module');
      const imports = Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        AuthModule,
      ) as unknown[];

      expect(imports).not.toContain(undefined);
    });
  });

  it('provides the rollout flags: the worker builds the DPS and runs the fiscal engine', () => {
    jest.isolateModules(() => {
      const { WorkerAppModule } = require('./worker-app.module');
      const { RolloutModule } = require('./shared/rollout/rollout.module');
      const imports = Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        WorkerAppModule,
      ) as unknown[];

      expect(imports).toContain(RolloutModule);
    });
  });
});
