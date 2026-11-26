/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-require-imports */
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PLATFORM_ADMIN_ONLY } from '@/modules/auth/platform-admin-only.decorator';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';

type Ctor = new (...args: never[]) => unknown;

/** Loads the whole module tree fresh: DEPLOYMENT_MODE is read at import time. */
function load(mode: 'cloud' | 'self_hosted') {
  const previous = process.env.DEPLOYMENT_MODE;
  process.env.DEPLOYMENT_MODE = mode;
  try {
    let result!: {
      imports: Array<{ name: string }>;
      controllers: Ctor[];
      guard: unknown;
      appImports: unknown[];
      workerImports: unknown[];
      PlatformAdminModule: unknown;
    };
    jest.isolateModules(() => {
      const { PlatformAdminModule } = require('./platform-admin.module');
      const { PlatformAdminGuard } = require('./platform-admin.guard');
      const { AppModule } = require('@/app.module');
      const { WorkerAppModule } = require('@/worker-app.module');
      const imports = Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        PlatformAdminModule,
      ) as Array<{ name: string }>;
      const controllers = imports.flatMap(
        (m) =>
          (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, m) as Ctor[]) ?? [],
      );
      result = {
        imports,
        controllers,
        guard: PlatformAdminGuard,
        appImports: Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule),
        workerImports: Reflect.getMetadata(
          MODULE_METADATA.IMPORTS,
          WorkerAppModule,
        ),
        PlatformAdminModule,
      };
    });
    return result;
  } finally {
    if (previous === undefined) delete process.env.DEPLOYMENT_MODE;
    else process.env.DEPLOYMENT_MODE = previous;
  }
}

const names = (list: Ctor[]) => list.map((c) => c.name).sort();

describe('PlatformAdminModule', () => {
  it('o AppModule importa PlatformAdminModule e o worker não', () => {
    const { appImports, workerImports, PlatformAdminModule } = load('cloud');
    expect(appImports).toContain(PlatformAdminModule);
    expect(workerImports).not.toContain(PlatformAdminModule);
  });

  it('agrega os sete módulos de feature', () => {
    const { imports } = load('cloud');
    expect(imports.map((m) => m.name).sort()).toEqual([
      'PlatformAttentionModule',
      'PlatformAuditModule',
      'PlatformCreditGrantModule',
      'PlatformNfeAccessModule',
      'PlatformOverviewModule',
      'PlatformUserDetailModule',
      'PlatformUsersModule',
    ]);
  });

  it('todo controller do módulo tem PLATFORM_ADMIN_ONLY e PlatformAdminGuard em __guards__', () => {
    const { controllers, guard } = load('cloud');
    expect(controllers).toHaveLength(7);
    for (const controller of controllers) {
      expect(Reflect.getMetadata(PLATFORM_ADMIN_ONLY, controller)).toBe(true);
      expect(Reflect.getMetadata('__guards__', controller)).toContain(guard);
      expect(
        Reflect.getMetadata(REQUIRED_TENANT_PERMISSION, controller),
      ).toBeUndefined();
    }
  });

  it('no self-hosted só a concessão some: os demais controllers continuam', () => {
    const cloud = names(load('cloud').controllers);
    const self = names(load('self_hosted').controllers);
    expect(cloud.filter((n) => !self.includes(n))).toEqual([
      'PlatformCreditGrantController',
    ]);
    expect(self).toHaveLength(6);
  });
});
