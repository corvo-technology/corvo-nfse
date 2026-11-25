import {
  FiscalValidationError,
  FiscalIssue,
} from '@/shared/fiscal/fiscal-validation-error';
import { parseCustomerTaxId } from '@/shared/tax-id';
import { normalizeUf } from '@/shared/fiscal/uf';
import { isAfterTodayInSaoPaulo } from './invoice-domain.service';

export interface RawInvoiceInput {
  customer: {
    name?: string;
    taxId?: string;
    email?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
  };
  service: {
    code?: string;
    municipalityCode?: string;
    description?: string;
  };
  amount?: number;
  competenceDate?: string;
  options?: {
    email?: { send?: boolean };
  };
}

export interface NormalizedInvoiceInput {
  customer: {
    name: string;
    taxId: string;
    taxIdKind: 'CPF' | 'CNPJ';
    email?: string;
    address: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
  };
  service: {
    code: string;
    municipalityCode?: string;
    description?: string;
  };
  amount: number;
  competenceDate: Date;
  emailSend: boolean;
}

export function normalizeInvoiceInput(
  input: RawInvoiceInput,
  allowFutureDate = false,
): NormalizedInvoiceInput {
  const issues: FiscalIssue[] = [];

  // ── customer.taxId ──────────────────────────────────────────────
  if (!input.customer?.taxId?.trim()) {
    issues.push({
      field: 'customer.taxId',
      code: 'required',
      message: 'customer.taxId is required',
    });
  } else {
    const parsed = parseCustomerTaxId(input.customer.taxId);
    if (!parsed) {
      issues.push({
        field: 'customer.taxId',
        code: 'invalid_tax_id',
        message: 'customer.taxId must be a valid CPF or CNPJ',
      });
    }
  }

  // ── address: city + state must both be present or both absent ──
  const hasCity = input.customer?.address?.city?.trim();
  const hasState = input.customer?.address?.state?.trim();
  if ((hasCity && !hasState) || (!hasCity && hasState)) {
    issues.push({
      field: 'customer.address',
      code: 'incomplete_address',
      message: 'customer.address requires both city and state',
    });
  }
  if (hasState) {
    const normalizedState = normalizeUf(input.customer.address!.state!);
    if (!normalizedState) {
      issues.push({
        field: 'customer.address.state',
        code: 'invalid_uf',
        message: 'customer.address.state must be a valid UF',
      });
    }
  }

  // ── service.code: 6 digits ──────────────────────────────────────
  if (!input.service?.code) {
    issues.push({
      field: 'service.code',
      code: 'required',
      message: 'service.code is required',
    });
  } else if (!/^\d{6}$/.test(input.service.code)) {
    issues.push({
      field: 'service.code',
      code: 'invalid_service_code',
      message: 'service.code must be exactly 6 digits',
    });
  }

  // ── municipalityCode: 7 digits if provided ──────────────────────
  if (
    input.service?.municipalityCode &&
    !/^\d{7}$/.test(input.service.municipalityCode)
  ) {
    issues.push({
      field: 'service.municipalityCode',
      code: 'invalid_ibge_code',
      message: 'service.municipalityCode must be exactly 7 digits',
    });
  }

  // ── amount: max 2 decimal places, positive, <= 9999999999.99 ──
  if (input.amount === undefined || input.amount === null) {
    issues.push({
      field: 'amount',
      code: 'required',
      message: 'amount is required',
    });
  } else {
    const rounded = Math.round(input.amount * 100) / 100;
    if (rounded !== input.amount) {
      issues.push({
        field: 'amount',
        code: 'invalid_decimal_places',
        message: 'amount must have at most 2 decimal places',
      });
    }
    if (input.amount <= 0) {
      issues.push({
        field: 'amount',
        code: 'out_of_range',
        message: 'amount must be positive',
      });
    }
    if (input.amount > 9999999999.99) {
      issues.push({
        field: 'amount',
        code: 'out_of_range',
        message: 'amount exceeds maximum allowed value',
      });
    }
  }

  // ── competenceDate: not future ───────────────────────────────────
  let competenceDate: Date;
  if (!input.competenceDate) {
    issues.push({
      field: 'competenceDate',
      code: 'required',
      message: 'competenceDate is required',
    });
    competenceDate = new Date();
  } else {
    const parsed = new Date(input.competenceDate);
    if (isNaN(parsed.getTime())) {
      issues.push({
        field: 'competenceDate',
        code: 'invalid_date',
        message: 'competenceDate must be a valid date',
      });
      competenceDate = new Date();
    } else {
      if (!allowFutureDate && isAfterTodayInSaoPaulo(parsed)) {
        issues.push({
          field: 'competenceDate',
          code: 'future_date',
          message: 'competenceDate cannot be in the future',
        });
      }
      competenceDate = parsed;
    }
  }

  // ── email: required if email.send === true ─────────────────────
  const emailSend = input.options?.email?.send ?? false;
  if (emailSend && !input.customer?.email?.trim()) {
    issues.push({
      field: 'customer.email',
      code: 'required',
      message: 'customer.email is required when email notification is enabled',
    });
  }

  if (issues.length > 0) {
    throw new FiscalValidationError(issues);
  }

  const parsed = parseCustomerTaxId(input.customer.taxId!);
  const hasCity2 = input.customer.address?.city?.trim();
  const hasState2 = input.customer.address?.state?.trim();

  return {
    customer: {
      name: input.customer.name?.trim() ?? 'Consumidor',
      taxId: parsed!.value,
      taxIdKind: parsed!.kind,
      email: input.customer.email?.trim(),
      address: {
        street: input.customer.address?.street?.trim(),
        city: hasCity2 ? input.customer.address!.city!.trim() : undefined,
        state: hasState2
          ? normalizeUf(input.customer.address!.state!)
          : undefined,
      },
    },
    service: {
      code: input.service.code!,
      municipalityCode: input.service.municipalityCode?.trim(),
      description: input.service.description?.trim(),
    },
    amount: Math.round(input.amount! * 100) / 100,
    competenceDate,
    emailSend,
  };
}
