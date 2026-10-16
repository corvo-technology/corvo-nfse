import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('opens after N consecutive failures and rejects without passing', () => {
    const t = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      resetMs: 1000,
      now: () => t,
    });
    cb.onFailure();
    cb.onFailure();
    expect(cb.canPass()).toBe(true);
    cb.onFailure();
    expect(cb.state).toBe('open');
    expect(cb.canPass()).toBe(false);
  });

  it('goes half-open after resetMs and closes on success', () => {
    let t = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetMs: 1000,
      now: () => t,
    });
    cb.onFailure();
    t = 1001;
    expect(cb.canPass()).toBe(true);
    expect(cb.state).toBe('half-open');
    cb.onSuccess();
    expect(cb.state).toBe('closed');
  });

  it('a success resets the failure count', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetMs: 1000 });
    cb.onFailure();
    cb.onFailure();
    cb.onSuccess();
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe('closed');
  });

  it('reopens when the half-open probe fails', () => {
    let t = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetMs: 1000,
      now: () => t,
    });
    cb.onFailure();
    t = 1001;
    expect(cb.canPass()).toBe(true);
    cb.onFailure();
    expect(cb.state).toBe('open');
    expect(cb.canPass()).toBe(false);
  });
});
