import { Inject, Injectable, Optional } from '@nestjs/common';
import { DateTime } from 'luxon';

import {
  FiscalValidationError,
  FiscalIssue,
} from '@/shared/fiscal/fiscal-validation-error';
import { parseCustomerTaxId } from '@/shared/tax-id';
import { normalizeCep } from '@/shared/fiscal/cep';
import { normalizeUf } from '@/shared/fiscal/uf';
import type { CreateInvoiceDto } from '../http/invoice.dto';

export const SCHEDULE_MAX_DAYS = 'SCHEDULE_MAX_DAYS';
const SCHEDULE_ZONE = 'America/Sao_Paulo';

export interface NormalizedInvoiceInput {
  customer: {
    name: string;
    taxId: string;
    taxIdKind: 'CPF' | 'CNPJ';
    email?: string;
    address: {
      street?: string;
      city: string;
      state: string;
      zip?: string;
    };
  };
  service: {
    code: string;
    municipalityCode: string;
    description?: string;
  };
  amount: number;
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
    private readonly scheduleMaxDays: number = 365,
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

    // ── customer.taxId ──────────────────────────────────────────────
    if (!dto.customer?.taxId?.trim()) {
      issues.push({
        field: 'customer.taxId',
        code: 'required',
        message: 'customer.taxId is required',
      });
    } else {
      const parsed = parseCustomerTaxId(dto.customer.taxId);
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
    const parsed = parseCustomerTaxId(dto.customer.taxId)!;
    const hasCityN = dto.customer.address?.city?.trim();
    const hasStateN = dto.customer.address?.state?.trim();
    const state = hasStateN ? normalizeUf(hasStateN) : 'SS';
    const city = hasCityN ? dto.customer.address!.city!.trim() : 'SIM';

    return {
      companyId: dto.companyId,
      externalId: dto.externalId,
      environment,
      customer: {
        name: dto.customer.name?.trim() ?? 'Consumidor',
        taxId: parsed.value,
        taxIdKind: parsed.kind,
        email: dto.customer.email?.trim(),
        address: {
          street: dto.customer.address?.street?.trim(),
          city,
          state,
          zip: dto.customer.address?.zip
            ? normalizeCep(dto.customer.address.zip)
            : undefined,
        },
      },
      service: {
        code: code!,
        municipalityCode: municipalityCode!,
        description: dto.service.description?.trim(),
      },
      amount: Math.round(dto.amount * 100) / 100,
      competenceDate,
      scheduledFor,
      emailSend,
    };
  }
}
