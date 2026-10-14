import { OutboxHandlerRegistry } from './outbox-handler.registry';

it('rejects duplicate handler registration and preserves the original handler', () => {
  const registry = new OutboxHandlerRegistry();
  const first = { type: 'invoice.emit', handle: jest.fn() };
  registry.register(first);
  expect(() =>
    registry.register({ type: first.type, handle: jest.fn() }),
  ).toThrow('Outbox handler already registered for invoice.emit');
  expect(registry.get(first.type)).toBe(first);
});
