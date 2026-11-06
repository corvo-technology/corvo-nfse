import { webhookVisibleTo } from './webhook-config';

describe('webhookVisibleTo', () => {
  it('shows everything to dashboard sessions (no key environment)', () => {
    expect(webhookVisibleTo({ environment: 'live' })).toBe(true);
    expect(webhookVisibleTo({ environment: 'test' })).toBe(true);
    expect(webhookVisibleTo({ environment: null })).toBe(true);
  });

  it('limits an API key to endpoints of its own environment', () => {
    expect(webhookVisibleTo({ environment: 'live' }, 'test')).toBe(false);
    expect(webhookVisibleTo({ environment: 'test' }, 'test')).toBe(true);
    expect(webhookVisibleTo({ environment: 'test' }, 'live')).toBe(false);
  });

  it('treats older endpoints (both environments) as live for API keys', () => {
    expect(webhookVisibleTo({ environment: null }, 'live')).toBe(true);
    expect(webhookVisibleTo({ environment: null }, 'test')).toBe(false);
  });
});
