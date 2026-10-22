import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { createConcurrencyLimit } from './concurrency-limit.middleware';

function res() {
  const emitter = new EventEmitter();
  const json = jest.fn();
  const response = Object.assign(emitter, {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json,
  });
  return response as unknown as Response & typeof response;
}
const req = (path = '/v1/invoices') => ({ path }) as Request;

describe('createConcurrencyLimit', () => {
  it('rejects with 503 once max requests are in flight and recovers on finish', () => {
    const limit = createConcurrencyLimit(1);
    const first = res();
    const next = jest.fn();
    limit(req(), first, next);
    const second = res();
    limit(req(), second, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(second.status).toHaveBeenCalledWith(503);
    expect(second.setHeader).toHaveBeenCalledWith('Retry-After', 1);
    first.emit('finish');
    first.emit('close');
    limit(req(), res(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('never sheds health checks and is disabled at 0', () => {
    const limit = createConcurrencyLimit(1);
    const next = jest.fn();
    limit(req(), res(), next);
    limit(req('/v1/health/live'), res(), next);
    expect(next).toHaveBeenCalledTimes(2);
    const off = createConcurrencyLimit(0);
    off(req(), res(), next);
    off(req(), res(), next);
    expect(next).toHaveBeenCalledTimes(4);
  });
});
