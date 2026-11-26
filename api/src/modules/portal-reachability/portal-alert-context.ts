import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { InvoiceOrmEntity } from '@/modules/invoice/infra/invoice.orm-entity';

const EGRESS_LOOKUP_URL = 'https://api.ipify.org';
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** What the alert e-mail says besides the classification: how much is waiting and our public IP. */
@Injectable()
export class PortalAlertContext {
  private readonly logger = new Logger(PortalAlertContext.name);

  constructor(@InjectDataSource() private readonly database: DataSource) {}

  /** Notes sent to the portal or waiting for its answer, across every workspace; null if the count fails. */
  async waitingNotes(): Promise<number | null> {
    try {
      return await runAsSystem('worker-discovery', () =>
        this.database
          .getRepository(InvoiceOrmEntity)
          .createQueryBuilder('invoice')
          .where("invoice.status IN ('processing','reconciliation_required')")
          .getCount(),
      );
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Could not count the waiting notes');
      return null;
    }
  }

  /** The public IP the servers go out with, asked only when an alert opens. Null when it cannot be read. */
  async egressIp(): Promise<string | null> {
    try {
      const response = await fetch(EGRESS_LOOKUP_URL, {
        signal: AbortSignal.timeout(3_000),
      });
      const text = (await response.text()).trim();
      return IPV4.test(text) ? text : null;
    } catch {
      return null;
    }
  }
}
