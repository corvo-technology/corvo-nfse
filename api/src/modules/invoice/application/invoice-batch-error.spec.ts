import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { toBatchItemError } from './invoice-batch-error';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { validationExceptionFactory } from '@/shared/http/validation-pipe';
import { IdempotencyConflictError } from '../domain/errors';
import {
  CompanyNotFoundError,
  CompanyNotReadyError,
} from '@/modules/company/domain/errors';
import {
  QuotaExceededError,
  QuotaExceededReason,
} from '@/modules/plans/application/quota.service';
import { BillingRuleError } from '@/modules/billing/domain/billing-period';

describe('toBatchItemError', () => {
  it('maps FiscalValidationError to ERROR_VALIDATION with its issues', () => {
    const issues = [
      { field: 'amount', code: 'out_of_range' as const, message: 'bad' },
    ];
    expect(toBatchItemError(new FiscalValidationError(issues))).toEqual({
      code: 'ERROR_VALIDATION',
      message: 'Request validation failed',
      details: issues,
    });
  });

  it('maps class-validator failures to ERROR_VALIDATION with field details', () => {
    const error = validationExceptionFactory([
      {
        property: 'companyTaxId',
        value: 'x',
        constraints: { isString: 'companyTaxId must be a string' },
        children: [],
      },
    ]);
    expect(toBatchItemError(error)).toEqual({
      code: 'ERROR_VALIDATION',
      message: 'Request validation failed',
      details: [
        {
          field: 'companyTaxId',
          code: 'ERROR_INVALID_TYPE',
          message: 'companyTaxId must be a string',
        },
      ],
    });
  });

  it('maps HttpException below 500 through the API error body', () => {
    expect(toBatchItemError(new NotFoundException('nope'))).toMatchObject({
      message: 'nope',
    });
    expect(
      toBatchItemError(new BadRequestException({ code: 'custom_thing' })),
    ).toMatchObject({ code: 'ERROR_CUSTOM_THING' });
  });

  it.each([
    [new IdempotencyConflictError('k'), 'ERROR_IDEMPOTENCY_CONFLICT'],
    [new CompanyNotFoundError('c'), 'ERROR_COMPANY_NOT_FOUND'],
    [new CompanyNotReadyError('c', ['certificate']), 'ERROR_COMPANY_NOT_READY'],
    [
      new QuotaExceededError(QuotaExceededReason.PLAN_BLOCKED, {}),
      'ERROR_QUOTA_EXCEEDED',
    ],
  ])('maps domain error %p to %s', (error, code) => {
    expect(toBatchItemError(error)?.code).toBe(code);
  });

  it('does not leak the internal message of domain errors', () => {
    expect(
      toBatchItemError(new CompanyNotFoundError('secret-id'))?.message,
    ).toBe('Company not found');
  });

  it('maps ApplicationError to its code and safe message', () => {
    expect(
      toBatchItemError(
        new BillingRuleError('monthly_limit_exceeded', 'Limit reached'),
      ),
    ).toEqual({
      code: 'ERROR_MONTHLY_LIMIT_EXCEEDED',
      message: 'Limit reached',
    });
  });

  it('returns null for unexpected errors', () => {
    expect(toBatchItemError(new Error('boom'))).toBeNull();
    expect(
      toBatchItemError(new QueryFailedError('SELECT 1', [], new Error('db'))),
    ).toBeNull();
  });
});
