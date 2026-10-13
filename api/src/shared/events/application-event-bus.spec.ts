import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApplicationEventBus } from './application-event-bus';

describe(ApplicationEventBus.name, () => {
  it('propagates failures for required events', async () => {
    const failure = new Error('financial convergence failed');
    const emitter = { emitAsync: jest.fn().mockRejectedValue(failure) };
    const bus = new ApplicationEventBus(emitter as unknown as EventEmitter2);

    await expect(
      bus.publishRequired({ name: 'payment.realized' }),
    ).rejects.toBe(failure);
  });

  it('publishes an event and waits for its handlers', async () => {
    const emitter = { emitAsync: jest.fn().mockResolvedValue([]) };
    const bus = new ApplicationEventBus(emitter as unknown as EventEmitter2);

    await expect(
      bus.publishAndWait({ name: 'authorization.context.changed' }),
    ).resolves.toBeUndefined();
    expect(emitter.emitAsync).toHaveBeenCalledWith(
      'authorization.context.changed',
      { name: 'authorization.context.changed' },
    );
  });

  it('does not reject the caller when a waited handler fails', async () => {
    const emitter = {
      emitAsync: jest.fn().mockRejectedValue(new Error('listener failed')),
    };
    const bus = new ApplicationEventBus(emitter as unknown as EventEmitter2);

    await expect(
      bus.publishAndWait({ name: 'authorization.context.changed' }),
    ).resolves.toBeUndefined();
  });

  it('does not throw synchronously when a best-effort handler fails', async () => {
    const emitter = {
      emitAsync: jest.fn().mockRejectedValue(new Error('listener failed')),
    };
    const bus = new ApplicationEventBus(emitter as unknown as EventEmitter2);

    expect(() =>
      bus.publishBestEffort({ name: 'appointment.created' }),
    ).not.toThrow();
    await Promise.resolve();
    expect(emitter.emitAsync).toHaveBeenCalled();
  });
});
