import type { NfePreconditionError } from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import { NfeDocument } from '../domain/nfe-document';
import { documentParams } from '../testing/document-fixture';
import { toNfeHttpError } from './nfe-error-http';

describe('toNfeHttpError', () => {
  const rejected = () => {
    const doc = NfeDocument.create(documentParams());
    doc.transitionTo('processing');
    doc.recordError({
      type: 'validation',
      code: '225',
      message: 'Rejeição: Falha no Schema XML do lote de NFe',
    });
    doc.transitionTo('rejected', { cStat: '225' });
    return doc;
  };

  it('a SEFAZ rejection is a validation error with the hint of its code', () => {
    expect(toNfeHttpError(rejected().toSnapshot())).toEqual({
      error: {
        type: 'validation',
        code: '225',
        message: 'Rejeição: Falha no Schema XML do lote de NFe',
        hint: expect.stringContaining('schema'),
      },
    });
  });

  it('a lost answer is a communication error, with no hint', () => {
    const doc = NfeDocument.create(documentParams());
    doc.transitionTo('processing');
    doc.recordError({
      type: 'communication',
      code: 'SEFAZ_NO_ANSWER',
      message: 'Não houve resposta da SEFAZ',
    });
    doc.transitionTo('reconciliation_required');
    const body = toNfeHttpError(doc.toSnapshot());
    expect(body?.error).toMatchObject({
      type: 'communication',
      code: 'SEFAZ_NO_ANSWER',
    });
    expect(body?.error).not.toHaveProperty('hint');
  });

  it('a document without error has none', () => {
    expect(
      toNfeHttpError(NfeDocument.create(documentParams()).toSnapshot()),
    ).toBeNull();
  });

  it('a list of issues is a validation error with the fields', () => {
    const issues = [
      { field: 'items[0].ncm', code: 'NCM_INVALID', message: 'NCM inválido' },
    ];
    expect(toNfeHttpError(issues)).toEqual({
      error: {
        type: 'validation',
        code: 'NFE_VALIDATION_FAILED',
        message: expect.any(String),
        issues,
      },
    });
  });

  it('a precondition failure is a configuration error', () => {
    const blocked: NfePreconditionError = {
      code: 'UF_NOT_ENABLED',
      message: 'UF ainda não liberada',
      step: 'nfe_preconditions',
      details: { uf: 'AM' },
      retryable: false,
      category: 'CONFIGURATION',
    };
    expect(toNfeHttpError(blocked)).toEqual({
      error: {
        type: 'configuration',
        code: 'UF_NOT_ENABLED',
        message: 'UF ainda não liberada',
      },
    });
  });
});
