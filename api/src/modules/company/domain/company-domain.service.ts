import { Injectable } from '@nestjs/common';
import {
  FiscalValidationError,
  FiscalIssue,
} from '@/shared/fiscal/fiscal-validation-error';
import { isValidCnpj } from '@/shared/fiscal/cnpj';
import { normalizeCnpj } from '@/shared/fiscal/cnpj';
import { isValidCep } from '@/shared/fiscal/cep';
import { normalizeCep } from '@/shared/fiscal/cep';
import { normalizeUf, isValidUf } from '@/shared/fiscal/uf';
import type { CreateCompanyInput, UpdateCompanyInput } from './company';
import {
  SIMPLES_ISS_RATE_MAX,
  SIMPLES_ISS_RATE_MIN,
} from './fiscal-profile.validator';

/** Format and bounds of the two Simples Nacional rates (percent, 2 decimals). */
export function simplesRateIssues(
  input: Pick<UpdateCompanyInput, 'simplesRate' | 'simplesIssRate'>,
): FiscalIssue[] {
  const issues: FiscalIssue[] = [];
  const check = (
    field: 'simplesRate' | 'simplesIssRate',
    value: string | null | undefined,
    min: number,
    max: number,
  ) => {
    if (value === undefined || value === null) return;
    const text = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text))
      issues.push({
        field,
        code: 'invalid',
        message: `${field} must be a percentage with at most 2 decimal places`,
      });
    else if (Number(text) < min || Number(text) > max)
      issues.push({
        field,
        code: 'out_of_range',
        message: `${field} must be between ${min} and ${max}`,
      });
  };
  check('simplesRate', input.simplesRate, 0, 100);
  check(
    'simplesIssRate',
    input.simplesIssRate,
    SIMPLES_ISS_RATE_MIN,
    SIMPLES_ISS_RATE_MAX,
  );
  return issues;
}

export interface NormalizedCreateCompanyInput extends Omit<
  CreateCompanyInput,
  'taxId' | 'address'
> {
  taxId: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

export interface NormalizedUpdateCompanyInput extends Omit<
  UpdateCompanyInput,
  'taxId' | 'address'
> {
  taxId?: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
}

@Injectable()
export class CompanyDomainService {
  /**
   * Validates and normalizes company creation input.
   * Throws FiscalValidationError with ALL grouped issues on failure.
   */
  validateAndNormalizeCreate(
    input: CreateCompanyInput,
  ): NormalizedCreateCompanyInput {
    const issues: FiscalIssue[] = [];

    this.validateFiscalDefaults(input, issues, true);
    // The Simples Nacional rate is asked at registration; a MEI has none (ignored if sent).
    const simples = input.taxRegime === 'Simples Nacional';
    if (simples && !input.simplesRate?.trim())
      issues.push({
        field: 'simplesRate',
        code: 'required',
        message:
          'simplesRate is required for Simples Nacional (the effective rate of your DAS)',
      });
    if (simples) issues.push(...simplesRateIssues(input));
    // municipalReg is optional even in live: the national system rejects the
    // provider's IM (E0120) when the municipality has no complementary data for it.

    // ── taxId: required + format ─────────────────────────────────
    const rawTaxId = input.taxId?.trim();
    if (!rawTaxId) {
      issues.push({
        field: 'taxId',
        code: 'required',
        message: 'taxId is required',
      });
    } else {
      const normalized = normalizeCnpj(rawTaxId);
      if (!isValidCnpj(normalized)) {
        issues.push({
          field: 'taxId',
          code: 'invalid_cnpj',
          message: 'taxId must be a valid CNPJ',
        });
      }
    }

    // ── municipalReg: cannot be blank string ─────────────────────
    if (input.municipalReg !== undefined && input.municipalReg !== null) {
      const trimmed = input.municipalReg.trim();
      if (trimmed === '') {
        issues.push({
          field: 'municipalReg',
          code: 'blank',
          message: 'municipalReg must not be blank',
        });
      }
    }

    // ── address: state UF validation ──────────────────────────────
    const rawState = input.address?.state?.trim();
    if (rawState && !isValidUf(rawState)) {
      issues.push({
        field: 'address.state',
        code: 'invalid_uf',
        message: 'address.state must be a valid UF',
      });
    }

    // ── address: zip CEP validation ───────────────────────────────
    const rawZip = input.address?.zip?.trim();
    if (rawZip && !isValidCep(rawZip)) {
      issues.push({
        field: 'address.zip',
        code: 'invalid_cep',
        message: 'address.zip must be a valid CEP (8 digits)',
      });
    }

    if (issues.length > 0) {
      throw new FiscalValidationError(issues);
    }

    // ── Normalize ─────────────────────────────────────────────────
    const normalizedTaxId = normalizeCnpj(rawTaxId);
    return {
      ...input,
      simplesRate: simples ? input.simplesRate?.trim() : undefined,
      simplesIssRate: simples ? input.simplesIssRate?.trim() : undefined,
      taxId: normalizedTaxId,
      municipalityCode: input.municipalityCode?.trim(),
      defaultServiceCode: input.defaultServiceCode?.trim(),
      municipalReg:
        input.municipalReg === null
          ? undefined
          : (input.municipalReg?.trim() ?? undefined),
      address: input.address
        ? {
            street: input.address.street?.trim(),
            number: input.address.number?.trim(),
            complement: input.address.complement?.trim(),
            district: input.address.district?.trim(),
            city: input.address.city?.trim(),
            state: rawState ? normalizeUf(rawState) : undefined,
            zip: rawZip ? normalizeCep(rawZip) : undefined,
          }
        : undefined,
    };
  }

  /**
   * Validates and normalizes company update input.
   * Throws FiscalValidationError with ALL grouped issues on failure.
   */
  validateAndNormalizeUpdate(
    input: UpdateCompanyInput,
  ): NormalizedUpdateCompanyInput {
    const issues: FiscalIssue[] = [];

    this.validateFiscalDefaults(input, issues, false);
    issues.push(...simplesRateIssues(input));

    if (input.taxId !== undefined) {
      const raw = input.taxId.trim();
      if (!raw) {
        issues.push({
          field: 'taxId',
          code: 'blank',
          message: 'taxId must not be blank',
        });
      } else {
        const normalized = normalizeCnpj(raw);
        if (!isValidCnpj(normalized)) {
          issues.push({
            field: 'taxId',
            code: 'invalid_cnpj',
            message: 'taxId must be a valid CNPJ',
          });
        }
      }
    }

    if (input.municipalReg !== undefined && input.municipalReg !== null) {
      const trimmed = input.municipalReg.trim();
      if (trimmed === '') {
        issues.push({
          field: 'municipalReg',
          code: 'blank',
          message: 'municipalReg must not be blank',
        });
      }
    }

    if (input.address !== undefined && input.address !== null) {
      const rawState = input.address.state?.trim();
      if (rawState && !isValidUf(rawState)) {
        issues.push({
          field: 'address.state',
          code: 'invalid_uf',
          message: 'address.state must be a valid UF',
        });
      }
      const rawZip = input.address.zip?.trim();
      if (rawZip && !isValidCep(rawZip)) {
        issues.push({
          field: 'address.zip',
          code: 'invalid_cep',
          message: 'address.zip must be a valid CEP (8 digits)',
        });
      }
    }

    if (issues.length > 0) {
      throw new FiscalValidationError(issues);
    }

    // ── Normalize ─────────────────────────────────────────────────
    return {
      ...input,
      taxId:
        input.taxId !== undefined
          ? normalizeCnpj(input.taxId.trim())
          : undefined,
      municipalityCode: input.municipalityCode?.trim(),
      defaultServiceCode:
        input.defaultServiceCode === null
          ? null
          : input.defaultServiceCode?.trim(),
      municipalReg:
        input.municipalReg === null
          ? null
          : (input.municipalReg?.trim() ?? undefined),
      address:
        input.address === null
          ? null
          : input.address
            ? {
                street: input.address.street?.trim(),
                number: input.address.number?.trim(),
                complement: input.address.complement?.trim(),
                district: input.address.district?.trim(),
                city: input.address.city?.trim(),
                state: input.address.state
                  ? normalizeUf(input.address.state.trim())
                  : undefined,
                zip: input.address.zip
                  ? normalizeCep(input.address.zip.trim())
                  : undefined,
              }
            : undefined,
    };
  }
  private validateFiscalDefaults(
    input: CreateCompanyInput | UpdateCompanyInput,
    issues: FiscalIssue[],
    creating: boolean,
  ): void {
    if (creating || input.municipalityCode !== undefined) {
      const value = input.municipalityCode;
      if (typeof value !== 'string' || !/^\d{7}$/.test(value.trim())) {
        issues.push({
          field: 'municipalityCode',
          code: value === undefined ? 'required' : 'invalid_ibge_code',
          message: 'municipalityCode must be exactly 7 digits',
        });
      }
    }
    if (
      input.defaultServiceCode !== undefined &&
      (creating || input.defaultServiceCode !== null)
    ) {
      const value = input.defaultServiceCode;
      if (typeof value !== 'string' || !/^\d{6}$/.test(value.trim())) {
        issues.push({
          field: 'defaultServiceCode',
          code: 'invalid_service_code',
          message: 'defaultServiceCode must be exactly 6 digits',
        });
      }
    }
  }
}
