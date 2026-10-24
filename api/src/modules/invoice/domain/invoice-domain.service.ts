import { Inject, Injectable, Optional } from '@nestjs/common';
import { DateTime } from 'luxon';

import {
  FiscalValidationError,
  FiscalIssue,
} from '@/shared/fiscal/fiscal-validation-error';
import { parseCustomerTaxId } from '@/shared/tax-id';
import { normalizeCep } from '@/shared/fiscal/cep';
import { normalizeUf } from '@/shared/fiscal/uf';
import { toDecimal } from './fiscal/money';
import type { ServiceFiscalInput } from './fiscal/normalized-invoice';
import type { CreateInvoiceDto } from '../http/invoice.dto';

export const SCHEDULE_MAX_DAYS = 'SCHEDULE_MAX_DAYS';
const SCHEDULE_ZONE = 'America/Sao_Paulo';

export interface NormalizedCustomerInput {
  name: string;
  /** Absent for anonymous consumers. */
  taxId?: string;
  taxIdKind?: 'CPF' | 'CNPJ';
  email?: string;
  address: {
    street?: string;
    city: string;
    state: string;
    zip?: string;
    municipalityCode?: string;
  };
}

export interface NormalizedInvoiceInput {
  /** Null when the request carries no customer — anonymous consumer. */
  customer: NormalizedCustomerInput | null;
  service: {
    code: string;
    municipalityCode: string;
    description?: string;
    fiscal?: ServiceFiscalInput;
    serviceProfileId?: string;
  };
  amount: number;
  discount?: number;
  /** Issuer-declared deduction from the ISS base (e.g. partner professional share). */
  deduction?: number;
  competenceDate: Date;
  scheduledFor?: Date;
  emailSend: boolean;
  companyId: string;
  externalId?: string;
  environment: string;
}

@Injectable()
export class InvoiceDomainService {
  constructor(
    @Optional()
    @Inject(SCHEDULE_MAX_DAYS)
    private readonly scheduleMaxDays: number = 15,
  ) {}
  /**
   * Validates and normalizes raw invoice input.
   * Throws FiscalValidationError with ALL grouped issues if validation fails.
   * Returns NormalizedInvoiceInput ready for Invoice.create().
   *
   * The hash of idempotency is computed on the ORIGINAL request body,
   * not on the normalized values — this is done in InvoiceService.emit()
   * before calling this method.
   */
  normalizeAndValidate(
    dto: Omit<CreateInvoiceDto, 'companyId'> & { companyId: string },
    environment: string,
    defaults: { code?: string; municipalityCode?: string } = {},
  ): NormalizedInvoiceInput {
    const issues: FiscalIssue[] = [];
    if (!dto.service) {
      issues.push({
        field: 'service',
        code: 'required',
        message: 'service is required',
      });
    }

    // ── customer: sem nada ⇒ consumidor anônimo; com qualquer dado ⇒ CPF/CNPJ obrigatório ──
    const rawTaxId = dto.customer?.taxId?.trim();
    if (!rawTaxId && customerHasContent(dto.customer)) {
      issues.push({
        field: 'customer.taxId',
        code: 'required',
        message:
          'customer.taxId is required when a customer is sent; omit the customer for an anonymous consumer invoice',
      });
    }
    if (rawTaxId) {
      const parsed = parseCustomerTaxId(rawTaxId);
      if (!parsed) {
        issues.push({
          field: 'customer.taxId',
          code: 'invalid_tax_id',
          message: 'customer.taxId must be a valid CPF or CNPJ',
        });
      }
    }

    // ── address: city + state must both be present or both absent ──
    const hasCity = dto.customer?.address?.city?.trim();
    const hasState = dto.customer?.address?.state?.trim();
    if ((hasCity && !hasState) || (!hasCity && hasState)) {
      issues.push({
        field: 'customer.address',
        code: 'incomplete_address',
        message: 'customer.address requires both city and state',
      });
    }
    if (hasState && !normalizeUf(hasState)) {
      issues.push({
        field: 'customer.address.state',
        code: 'invalid_uf',
        message: 'customer.address.state must be a valid UF',
      });
    }

    const code =
      dto.service?.code === undefined ? defaults.code : dto.service.code;
    const municipalityCode =
      dto.service?.municipalityCode === undefined
        ? defaults.municipalityCode
        : dto.service.municipalityCode;
    if (code === undefined) {
      issues.push({
        field: 'service.code',
        code: 'required',
        message:
          'service.code is required when the company has no defaultServiceCode',
      });
    } else if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      issues.push({
        field: 'service.code',
        code: 'invalid_service_code',
        message: 'service.code must be exactly 6 digits',
      });
    }
    if (
      typeof municipalityCode !== 'string' ||
      !/^\d{7}$/.test(municipalityCode)
    ) {
      issues.push({
        field: 'service.municipalityCode',
        code: municipalityCode === undefined ? 'required' : 'invalid_ibge_code',
        message: 'service.municipalityCode must be exactly 7 digits',
      });
    }

    // ── amount: max 2 decimal places, positive, <= 9999999999.99 ──
    if (dto.amount === undefined || dto.amount === null) {
      issues.push({
        field: 'amount',
        code: 'required',
        message: 'amount is required',
      });
    } else {
      const rounded = Math.round(dto.amount * 100) / 100;
      if (rounded !== dto.amount) {
        issues.push({
          field: 'amount',
          code: 'invalid_decimal_places',
          message: 'amount must have at most 2 decimal places',
        });
      }
      if (dto.amount <= 0) {
        issues.push({
          field: 'amount',
          code: 'out_of_range',
          message: 'amount must be positive',
        });
      }
      if (dto.amount > 9999999999.99) {
        issues.push({
          field: 'amount',
          code: 'out_of_range',
          message: 'amount exceeds maximum allowed value',
        });
      }
    }

    // ── discount: optional, >= 0, <= amount, max 2 decimals ──────
    let discount: number | undefined;
    if (dto.discount !== undefined && dto.discount !== null) {
      if (typeof dto.discount !== 'number' || !Number.isFinite(dto.discount)) {
        issues.push({
          field: 'discount',
          code: 'invalid_type',
          message: 'discount must be a number',
        });
      } else {
        const rounded = Math.round(dto.discount * 100) / 100;
        if (rounded !== dto.discount) {
          issues.push({
            field: 'discount',
            code: 'invalid_decimal_places',
            message: 'discount must have at most 2 decimal places',
          });
        }
        if (dto.discount < 0) {
          issues.push({
            field: 'discount',
            code: 'out_of_range',
            message: 'discount must be greater than or equal to zero',
          });
        } else if (
          typeof dto.amount === 'number' &&
          Number.isFinite(dto.amount) &&
          toDecimal(String(dto.discount)).gt(toDecimal(String(dto.amount)))
        ) {
          issues.push({
            field: 'discount',
            code: 'out_of_range',
            message: 'discount cannot exceed the invoice amount',
          });
        }
        discount = rounded;
      }
    }

    // ── deduction: optional, > 0 and < amount - discount, max 2 decimals ──
    // Declared by the issuer (e.g. the partner professional share, Lei
    // 13.352/2016). Zero means "no deduction" and is dropped.
    let deduction: number | undefined;
    if (dto.deduction !== undefined && dto.deduction !== null) {
      if (
        typeof dto.deduction !== 'number' ||
        !Number.isFinite(dto.deduction)
      ) {
        issues.push({
          field: 'deduction',
          code: 'invalid_type',
          message: 'deduction must be a number',
        });
      } else {
        const rounded = Math.round(dto.deduction * 100) / 100;
        if (rounded !== dto.deduction) {
          issues.push({
            field: 'deduction',
            code: 'invalid_decimal_places',
            message: 'deduction must have at most 2 decimal places',
          });
        }
        if (dto.deduction < 0) {
          issues.push({
            field: 'deduction',
            code: 'out_of_range',
            message: 'deduction must be greater than or equal to zero',
          });
        } else if (
          dto.deduction > 0 &&
          typeof dto.amount === 'number' &&
          Number.isFinite(dto.amount) &&
          toDecimal(String(dto.deduction)).gte(
            toDecimal(String(dto.amount)).minus(
              toDecimal(String(discount ?? 0)),
            ),
          )
        ) {
          issues.push({
            field: 'deduction',
            code: 'out_of_range',
            message:
              'deduction must be less than the amount minus the discount',
          });
        }
        if (rounded > 0) deduction = rounded;
      }
    }

    // ── competenceDate: immediate or scheduled ───────────────────────────────────
    let competenceDate: Date;
    let scheduledFor: Date | undefined;
    if (!dto.competenceDate) {
      issues.push({
        field: 'competenceDate',
        code: 'required',
        message: 'competenceDate is required',
      });
      competenceDate = new Date();
    } else {
      competenceDate = new Date(dto.competenceDate);
      if (isNaN(competenceDate.getTime())) {
        issues.push({
          field: 'competenceDate',
          code: 'invalid_date',
          message: 'competenceDate must be a valid date',
        });
        competenceDate = new Date();
      } else if (dto.options?.type === 'SCHEDULE') {
        const today = DateTime.now().setZone(SCHEDULE_ZONE).startOf('day');
        const release = DateTime.fromISO(
          competenceDate.toISOString().slice(0, 10),
          {
            zone: SCHEDULE_ZONE,
          },
        ).startOf('day');
        if (release > today.plus({ days: this.scheduleMaxDays })) {
          issues.push({
            field: 'competenceDate',
            code: 'schedule_horizon_exceeded',
            message: `competenceDate cannot be more than ${this.scheduleMaxDays} days ahead`,
          });
        } else if (release > today) {
          scheduledFor = release.toJSDate();
        }
      } else if (competenceDate > new Date()) {
        issues.push({
          field: 'competenceDate',
          code: 'future_date',
          message: 'competenceDate cannot be in the future',
        });
      }
    }

    // ── email: required if email.send === true ─────────────────────
    const emailSend = dto.options?.email?.send ?? dto.email ?? false;
    if (emailSend && !dto.customer?.email?.trim()) {
      issues.push({
        field: 'customer.email',
        code: 'required',
        message:
          'customer.email is required when email notification is enabled',
      });
    }

    if (issues.length > 0) {
      throw new FiscalValidationError(issues);
    }

    // ── Normalize ────────────────────────────────────────────────────
    return {
      companyId: dto.companyId,
      externalId: dto.externalId,
      environment,
      customer: normalizeCustomerInput(dto.customer),
      service: {
        code: code!,
        municipalityCode: municipalityCode!,
        description: dto.service.description?.trim(),
        fiscal: dto.service.fiscal,
        serviceProfileId: dto.service.serviceProfileId,
      },
      amount: Math.round(dto.amount * 100) / 100,
      discount,
      deduction,
      competenceDate,
      scheduledFor,
      emailSend,
    };
  }
}

/** True when the customer carries any data; an empty object counts as no customer. */
function customerHasContent(customer: CreateInvoiceDto['customer']): boolean {
  if (!customer) return false;
  const address = customer.address;
  return (
    Boolean(customer.name?.trim()) ||
    Boolean(customer.taxId?.trim()) ||
    Boolean(customer.email?.trim()) ||
    Boolean(address?.street?.trim()) ||
    Boolean(address?.city?.trim()) ||
    Boolean(address?.state?.trim()) ||
    Boolean(address?.zip?.trim()) ||
    Boolean(address?.country?.trim()) ||
    Boolean(address?.municipalityCode?.trim())
  );
}

function normalizeCustomerInput(
  customer: CreateInvoiceDto['customer'],
): NormalizedCustomerInput | null {
  if (!customer) {
    return null;
  }
  const address = customer.address;
  const hasContent = customerHasContent(customer);
  if (!hasContent) {
    // Empty `{}` ⇒ consumidor anônimo: sem snapshot de cliente.
    return null;
  }
  const rawTaxId = customer.taxId?.trim();
  // Already validated above; `undefined` only for anonymous consumers.
  const parsedTaxId = rawTaxId ? parseCustomerTaxId(rawTaxId) : undefined;
  const state = address?.state?.trim();
  const city = address?.city?.trim();
  return {
    name: customer.name?.trim() || 'Consumidor',
    taxId: parsedTaxId?.value,
    taxIdKind: parsedTaxId?.kind,
    email: customer.email?.trim(),
    address: {
      street: address?.street?.trim(),
      city: city || 'SIM',
      state: state ? normalizeUf(state) : 'SS',
      zip: address?.zip ? normalizeCep(address.zip) : undefined,
      municipalityCode: address?.municipalityCode?.trim(),
    },
  };
}
