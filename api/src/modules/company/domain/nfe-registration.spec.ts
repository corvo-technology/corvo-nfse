import type { CadastroRegistration } from '@/infra/external/nfe/sefaz/cadastro';
import {
  assessRegistration,
  registrationBlocks,
  registrationMessage,
  REGISTRATION_CHECK_TTL_MS,
  type RegistrationCheck,
} from './nfe-registration';

const reg = (
  stateRegistration: string,
  enabled = true,
  nfeCredential: CadastroRegistration['nfeCredential'] = 'yes',
): CadastroRegistration => ({ stateRegistration, enabled, nfeCredential });

const found = (...registrations: CadastroRegistration[]) =>
  ({ kind: 'found', registrations }) as const;

describe('assessRegistration', () => {
  it('maps what the consulta cannot say', () => {
    expect(assessRegistration('1', { kind: 'no_certificate' }).status).toBe(
      'no_certificate',
    );
    expect(assessRegistration('1', { kind: 'unavailable' }).status).toBe(
      'unavailable',
    );
    expect(assessRegistration(null, { kind: 'not_found' }).status).toBe(
      'no_registration',
    );
  });

  it('with no IE saved: one enabled is suggested, several must be chosen, none is not enabled', () => {
    expect(
      assessRegistration(null, found(reg('111'), reg('222', false))),
    ).toMatchObject({
      status: 'ie_suggested',
      suggested: '111',
    });
    expect(assessRegistration('', found(reg('111'), reg('222')))).toMatchObject(
      {
        status: 'ie_choose',
        suggested: null,
      },
    );
    expect(assessRegistration(null, found(reg('111', false))).status).toBe(
      'not_enabled',
    );
  });

  it('with an IE saved: ready, not enabled, not credentialed or from another CNPJ', () => {
    expect(assessRegistration('11.1', found(reg('111'))).status).toBe('ready');
    expect(assessRegistration('111', found(reg('111', false))).status).toBe(
      'not_enabled',
    );
    expect(
      assessRegistration('111', found(reg('111', true, 'no'))).status,
    ).toBe('not_credentialed');
    expect(
      assessRegistration('111', found(reg('111', true, 'unknown'))).status,
    ).toBe('ready');
    expect(assessRegistration('999', found(reg('111')))).toMatchObject({
      status: 'ie_mismatch',
      suggested: '111',
    });
  });
});

describe('registrationMessage', () => {
  it('speaks plainly for each case', () => {
    const ctx = { uf: 'SP', stateRegistration: '111' };
    expect(registrationMessage('ready', ctx)).toBe(
      'IE 111 encontrada e habilitada para NF-e na SEFAZ de SP.',
    );
    expect(registrationMessage('no_registration', ctx)).toContain(
      'só presta serviço',
    );
    expect(registrationMessage('not_enabled', ctx)).toContain(
      'não está habilitada',
    );
    expect(registrationMessage('not_credentialed', ctx)).toContain(
      'credenciamento é feito no site da SEFAZ',
    );
    expect(registrationMessage('unavailable', ctx)).toContain('CCC');
    expect(
      registrationMessage('ie_mismatch', { ...ctx, suggested: '222' }),
    ).toContain('A encontrada é 222');
  });
});

describe('registrationBlocks', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const check = (over: Partial<RegistrationCheck> = {}): RegistrationCheck => ({
    status: 'not_enabled',
    checkedAt: new Date(now.getTime() - 60_000),
    stateRegistration: '110042490114',
    ...over,
  });

  it('stops a note on a fresh conclusive no for the saved IE', () => {
    expect(registrationBlocks(check(), '110.042.490.114', 55, now)).toBe(
      'not_enabled',
    );
    expect(
      registrationBlocks(
        check({ status: 'no_registration' }),
        '110042490114',
        65,
        now,
      ),
    ).toBe('no_registration');
  });

  it('never stops on a yes, an old answer, another IE or no answer', () => {
    expect(
      registrationBlocks(check({ status: 'ready' }), '110042490114', 55, now),
    ).toBeNull();
    expect(
      registrationBlocks(
        check({
          checkedAt: new Date(now.getTime() - REGISTRATION_CHECK_TTL_MS - 1),
        }),
        '110042490114',
        55,
        now,
      ),
    ).toBeNull();
    expect(registrationBlocks(check(), '999999999999', 55, now)).toBeNull();
    expect(registrationBlocks(null, '110042490114', 55, now)).toBeNull();
    expect(
      registrationBlocks(
        check({ status: 'unavailable' }),
        '110042490114',
        55,
        now,
      ),
    ).toBeNull();
  });

  it('the NFC-e has its own credenciamento: not_credentialed stops only the NF-e', () => {
    const c = check({ status: 'not_credentialed' });
    expect(registrationBlocks(c, '110042490114', 55, now)).toBe(
      'not_credentialed',
    );
    expect(registrationBlocks(c, '110042490114', 65, now)).toBeNull();
  });
});
