export function createUnavailablePort(portName: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (
          property === 'then' ||
          property === 'onModuleInit' ||
          property === 'onModuleDestroy' ||
          property === 'beforeApplicationShutdown' ||
          property === 'onApplicationShutdown' ||
          property === 'onApplicationBootstrap'
        ) {
          return undefined;
        }

        return () => {
          throw new Error(
            `${portName} has no infrastructure adapter registered yet`,
          );
        };
      },
    },
  );
}
