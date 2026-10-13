import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isValidCnpj } from './cnpj';
import { isValidCep } from './cep';
import { isValidIbgeCode } from './ibge-code';
import { isValidUf } from './uf';
import { parseCustomerTaxId } from '../tax-id';

function fiscalDecorator(
  name: string,
  predicate: (value: string) => boolean,
  message: string,
) {
  return (options?: ValidationOptions): PropertyDecorator =>
    (target, propertyKey) =>
      registerDecorator({
        name,
        target: target.constructor,
        propertyName: String(propertyKey),
        options: { message, ...options },
        validator: {
          validate: (value: unknown) =>
            typeof value === 'string' && predicate(value),
        },
      });
}

export const IsCnpj = fiscalDecorator(
  'isCnpj',
  isValidCnpj,
  '$property must be a valid CNPJ',
);
export const IsCpfOrCnpj = fiscalDecorator(
  'isCpfOrCnpj',
  (value) => parseCustomerTaxId(value) !== null,
  '$property must be a valid CPF or CNPJ',
);
export const IsCep = fiscalDecorator(
  'isCep',
  isValidCep,
  '$property must be a valid CEP (8 digits)',
);
export const IsIbgeCode = fiscalDecorator(
  'isIbgeCode',
  isValidIbgeCode,
  '$property must be a 7-digit IBGE code',
);
export const IsUf = fiscalDecorator(
  'isUf',
  isValidUf,
  '$property must be a valid UF',
);
export const IsServiceCode = fiscalDecorator(
  'isServiceCode',
  (value) => /^\d{6}$/.test(value),
  '$property must be a 6-digit national service code',
);
export const IsNotBlank = fiscalDecorator(
  'isNotBlank',
  (value) => value.trim().length > 0,
  '$property must not be blank',
);
