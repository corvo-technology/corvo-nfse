/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { CsrfService } from './csrf.service';

describe('CsrfService', () => {
  const service = new CsrfService({
    getOrThrow: jest.fn((key: string) =>
      key === 'auth'
        ? { csrfSigningSecret: 'a'.repeat(32) }
        : { corsOrigins: ['https://app.greenflow.test'] },
    ),
  } as any);

  it('binds signed tokens to one session and compares them safely', () => {
    const token = service.generateToken('session-a');
    expect(service.validateToken('session-a', token)).toBe(true);
    expect(service.validateToken('session-b', token)).toBe(false);
    expect(service.validateToken('session-a', `${token}x`)).toBe(false);
  });

  it('requires exact Origin, same-site Fetch Metadata, and an allowed content type', () => {
    expect(
      service.validateBrowserMutation({
        origin: 'https://app.greenflow.test',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json; charset=utf-8',
      }),
    ).toBe(true);
    expect(
      service.validateBrowserMutation({
        origin: 'https://evil.test',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      }),
    ).toBe(false);
    expect(
      service.validateBrowserMutation({
        origin: 'https://app.greenflow.test.evil.test',
        'content-type': 'application/json',
      }),
    ).toBe(false);
    expect(
      service.validateBrowserMutation({
        origin: 'https://app.greenflow.test',
        'content-type': 'text/plain',
      }),
    ).toBe(false);
  });
});
