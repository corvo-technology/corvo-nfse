function load(mode?: string) {
  const previous = process.env.DEPLOYMENT_MODE;
  if (mode === undefined) delete process.env.DEPLOYMENT_MODE;
  else process.env.DEPLOYMENT_MODE = mode;
  try {
    let controllers: unknown[] = [];
    let controller: unknown;
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access */
      const mod = require('./platform-credit-grant.module')
        .PlatformCreditGrantModule as object;
      controller =
        require('./http/platform-credit-grant.controller').PlatformCreditGrantController;
      controllers =
        (Reflect.getMetadata('controllers', mod) as unknown[] | undefined) ??
        [];
    });
    return { controllers, controller };
  } finally {
    if (previous === undefined) delete process.env.DEPLOYMENT_MODE;
    else process.env.DEPLOYMENT_MODE = previous;
  }
}

describe('PlatformCreditGrantModule', () => {
  it('registra o controller no modo cloud', () => {
    const { controllers, controller } = load('cloud');
    expect(controllers).toEqual([controller]);
  });

  it('sem controller quando DEPLOYMENT_MODE=self_hosted', () => {
    expect(load('self_hosted').controllers).toEqual([]);
  });
});
