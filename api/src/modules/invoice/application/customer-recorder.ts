import { Injectable, Logger } from '@nestjs/common';
import {
  CUSTOMER_NAME_MAX,
  CustomerDirectory,
} from '../domain/customer-directory';
import type { Invoice } from '../domain/invoice';
import { ANONYMOUS_CUSTOMER_NAME } from '../domain/invoice-domain.service';

/**
 * Remembers the customer of an invoice that was just accepted, so the next invoice for the
 * same CPF/CNPJ needs no name. Best effort: it never fails or delays an emission.
 */
@Injectable()
export class CustomerRecorder {
  private readonly logger = new Logger(CustomerRecorder.name);

  constructor(private readonly directory: CustomerDirectory) {}

  async rememberFrom(invoice: Invoice): Promise<void> {
    const customer = invoice.toSnapshot().customerSnapshot;
    // No document, or only the placeholder name: there is nothing worth remembering.
    if (!customer?.taxId) return;
    const name = customer.name?.trim();
    if (
      !name ||
      name === ANONYMOUS_CUSTOMER_NAME ||
      name.length > CUSTOMER_NAME_MAX
    )
      return;
    try {
      await this.directory.remember(
        { tenantId: invoice.tenantId, environment: invoice.environment },
        { taxId: customer.taxId, name, email: customer.email ?? null },
      );
    } catch (error) {
      this.logger.warn(
        `Could not remember the customer of invoice ${invoice.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
