import { Injectable } from '@nestjs/common';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { InvoiceNotSubstitutableError } from '../domain/errors';
import type { Invoice } from '../domain/invoice';
import type {
  CreateInvoiceDto,
  SubstituteInvoiceDto,
} from '../http/invoice.dto';
import { InvoiceService } from './invoice.service';

/**
 * Old invoices stored city "SIM" and state "SS" when no address was given, and
 * "EX" marks a customer abroad. None of them is a real address to repeat.
 */
function isPlaceholderAddress(address: {
  city?: string;
  state?: string;
}): boolean {
  return (
    address.state === 'SS' || address.state === 'EX' || address.city === 'SIM'
  );
}

/**
 * Issues the substitute of an authorized NFS-e. The substitute repeats the original and changes
 * only what the Sefin lets a MEI or Simples Nacional issuer change (rule E0061 forbids changing
 * the customer, the competence date and the amount). The original stays authorized until the
 * Sefin authorizes the substitute; a refusal leaves it untouched.
 */
@Injectable()
export class InvoiceSubstitutionService {
  constructor(private readonly invoices: InvoiceService) {}

  async substitute(
    invoiceId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    dto: SubstituteInvoiceDto,
    idempotencyKey?: string,
  ): Promise<Invoice> {
    const original = await this.invoices.findById(
      invoiceId,
      tenantId,
      environment,
    );
    if (original.status !== 'authorized' || !original.accessKey)
      throw new InvoiceNotSubstitutableError(original.status);
    return this.invoices.emitInEnvironment(
      this.substituteBody(original, dto),
      tenantId,
      environment,
      idempotencyKey,
      { invoiceId: original.id, description: dto.description.trim() },
    );
  }

  /** The original invoice as a request body, with the allowed changes applied. */
  private substituteBody(
    original: Invoice,
    dto: SubstituteInvoiceDto,
  ): CreateInvoiceDto {
    const snapshot = original.toSnapshot();
    const customer = snapshot.customerSnapshot;
    const service = snapshot.serviceSnapshot;
    const address =
      customer?.address && !isPlaceholderAddress(customer.address)
        ? {
            city: customer.address.city,
            state: customer.address.state,
            municipalityCode: customer.address.municipalityCode,
          }
        : undefined;
    return {
      companyId: snapshot.companyId,
      ...(customer
        ? {
            customer: {
              taxId: customer.taxId,
              name: customer.name,
              email: customer.email,
              address,
              // A customer abroad is repeated as issued: it replaces the CPF/CNPJ and the address.
              ...(customer.foreign ? { foreign: customer.foreign } : {}),
            },
          }
        : {}),
      service: {
        description: dto.service?.description ?? service.description,
        code: service.code,
        municipalityCode: service.municipalityCode,
        fiscal: service.fiscal,
        serviceProfileId: service.serviceProfileId,
      },
      amount: snapshot.amount,
      discount: snapshot.discount,
      deduction: snapshot.deduction,
      competenceDate: new Date(snapshot.competenceDate)
        .toISOString()
        .slice(0, 10),
      // Undefined keeps what the original had; an empty text removes it.
      purchaseOrder: dto.purchaseOrder ?? service.purchaseOrder,
      notes: dto.notes ?? service.notes,
      options: { email: { send: Boolean(snapshot.emailSnapshot?.send) } },
    };
  }
}
