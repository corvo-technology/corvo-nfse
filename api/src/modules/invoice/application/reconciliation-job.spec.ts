import { HttpStatusError, NotFoundError } from 'open-nfse';
import {
  isPendingJobState,
  isPortalLookupRejected,
  portalBodyOf,
  reconciliationJobKey,
  sanitizePortalBody,
} from './reconciliation-job';

describe('reconciliation job ids', () => {
  it('alternates two slots so the next attempt never collides with the running one', () => {
    expect(reconciliationJobKey('inv', 0)).toBe('reconcile:inv:0');
    expect(reconciliationJobKey('inv', 1)).toBe('reconcile:inv:1');
    expect(reconciliationJobKey('inv', 2)).toBe('reconcile:inv:0');
  });

  it('treats only unfinished states as pending', () => {
    for (const s of ['waiting', 'delayed', 'active', 'prioritized'])
      expect(isPendingJobState(s)).toBe(true);
    for (const s of ['completed', 'failed', 'unknown', null])
      expect(isPendingJobState(s)).toBe(false);
  });
});

describe('portal lookup rejection', () => {
  it('is only HTTP 400', () => {
    expect(isPortalLookupRejected(new HttpStatusError(400, ''))).toBe(true);
    expect(isPortalLookupRejected(new HttpStatusError(422, ''))).toBe(false);
    expect(isPortalLookupRejected(new NotFoundError(''))).toBe(false);
    expect(isPortalLookupRejected(new Error('HTTP 400'))).toBe(false);
  });

  it('keeps the body short and strips personal data and tokens', () => {
    const body =
      '<erro>CNPJ 11.222.333/0001-81 CPF 123.456.789-09 a.b@c.com Bearer abc.def ' +
      'abcdefghijklmnopqrstuvwxyz0123 inválido</erro>' +
      ' x'.repeat(300);
    const out = sanitizePortalBody(body);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).toContain('[cnpj]');
    expect(out).toContain('[cpf]');
    expect(out).toContain('[e-mail]');
    expect(out).not.toMatch(/11\.222|123\.456|a\.b@c|abcdefghij|</);
  });

  it('reads the body of an HTTP error and nothing else', () => {
    expect(portalBodyOf(new HttpStatusError(400, 'DPS inválido'))).toBe(
      'DPS inválido',
    );
    expect(portalBodyOf(new Error('x'))).toBe('');
  });
});
