import { err, ok } from './result';

describe('Result', () => {
  it('ok carries a value', () => expect(ok(1)).toEqual({ ok: true, value: 1 }));
  it('err carries an error', () =>
    expect(err('x')).toEqual({ ok: false, error: 'x' }));
});
