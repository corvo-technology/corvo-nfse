import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type {
  FiscalIssue,
  FiscalIssueCode,
} from '@/shared/fiscal/fiscal-validation-error';

const CODE_BY_CONSTRAINT: Record<string, FiscalIssueCode> = {
  isCnpj: 'invalid_cnpj',
  isCpfOrCnpj: 'invalid_tax_id',
  isCep: 'invalid_cep',
  isIbgeCode: 'invalid_ibge_code',
  isUf: 'invalid_uf',
  isServiceCode: 'invalid_service_code',
  isNotBlank: 'blank',
  maxLength: 'too_long',
  minLength: 'too_short',
  isEmail: 'invalid_email',
  isUuid: 'invalid_uuid',
  isNumber: 'invalid_type',
  isInt: 'invalid_type',
  isBoolean: 'invalid_type',
  isString: 'invalid_type',
  isObject: 'invalid_type',
  isIn: 'invalid_option',
  isDateString: 'invalid_date',
  min: 'out_of_range',
  max: 'out_of_range',
  isPositive: 'out_of_range',
  whitelistValidation: 'unknown_field',
};

const PRIORITY: FiscalIssueCode[] = [
  'required',
  'unknown_field',
  'blank',
  'too_long',
  'too_short',
];

function flatten(errors: ValidationError[], parent = ''): FiscalIssue[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const issues: FiscalIssue[] = [];
    const keys = Object.keys(error.constraints ?? {});
    if (keys.length > 0) {
      const codes: FiscalIssueCode[] =
        error.value === undefined && !keys.includes('whitelistValidation')
          ? ['required']
          : keys.map((key) => CODE_BY_CONSTRAINT[key] ?? 'invalid');
      const code = [...codes].sort(
        (a, b) =>
          (PRIORITY.indexOf(a) === -1 ? 99 : PRIORITY.indexOf(a)) -
          (PRIORITY.indexOf(b) === -1 ? 99 : PRIORITY.indexOf(b)),
      )[0];
      const message =
        code === 'required'
          ? `${field} is required`
          : (error.constraints as Record<string, string>)[keys[0]];
      issues.push({ field, code, message });
    }
    return [...issues, ...flatten(error.children ?? [], field)];
  });
}

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const details = flatten(errors);
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'validation_error',
    message: 'Request validation failed',
    details,
  });
}

/**
 * Opt-out of the unknown-field rejection for a DTO: declare
 * `static readonly allowUnknownProperties = true`. Unknown fields are then
 * dropped instead of rejected. Meant for protocols that require servers to
 * ignore metadata they do not understand (RFC 7591 client registration).
 */
interface AllowsUnknownProperties {
  allowUnknownProperties?: boolean;
  /**
   * A DTO that shares its route with another kind of body (`POST /invoices` takes an NFS-e or,
   * with `type: "nfe"`, an NF-e): when this says so for the value, the body goes through as it
   * came and the handler hands it to the type that owns it. Own static only, never inherited.
   */
  bypassValidation?: (value: unknown) => boolean;
}

const pipeOptions = {
  transform: true,
  whitelist: true,
  validationError: { target: false, value: true },
  exceptionFactory: validationExceptionFactory,
};

class CorvoValidationPipe extends ValidationPipe {
  private readonly lenient = new ValidationPipe({
    ...pipeOptions,
    forbidNonWhitelisted: false,
  });

  constructor() {
    super({ ...pipeOptions, forbidNonWhitelisted: true });
  }

  override transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    const target = metadata.metatype as AllowsUnknownProperties | undefined;
    if (
      target &&
      Object.prototype.hasOwnProperty.call(target, 'bypassValidation') &&
      target.bypassValidation?.(value) === true
    )
      return Promise.resolve(value);
    return target?.allowUnknownProperties === true
      ? this.lenient.transform(value, metadata)
      : super.transform(value, metadata);
  }
}

export function createValidationPipe(): ValidationPipe {
  return new CorvoValidationPipe();
}
