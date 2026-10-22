import { Inject, Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { CompanyService } from '@/modules/company/application/company.service';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import { NfseProviderFactory } from '@/infra/external/nfse/nfse-provider.factory';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';
import type { Invoice } from '../domain/invoice';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import type { FiscalJobData } from './nfse-workflow.service';

/** Sends the cancellation event of a `cancelling` invoice and records the Sefin outcome. */
@Injectable()
export class NfseCancellationService {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    private readonly companies: CompanyService,
    private readonly certificates: ApplicationCertificateDecryptor,
    private readonly providers: NfseProviderFactory,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly webhooks: InvoiceWebhookPublisher,
  ) {}

  async process(data: FiscalJobData): Promise<void> {
    return runWithTenant(data.tenantId, () => this.processTenant(data));
  }

  private async processTenant(data: FiscalJobData): Promise<void> {
    const invoice = await this.invoices.findByIdAndTenantId(
      data.invoiceId,
      data.tenantId,
    );
    if (!invoice || invoice.status !== 'cancelling') return;
    const reason = invoice.cancellationReason;
    if (!reason?.description || !invoice.accessKey)
      throw new Error('Cancelling invoice lacks reason or access key');
    const company = await this.companies.findById(
      invoice.companyId,
      invoice.tenantId,
      invoice.environment,
    );
    const credentials = await this.credentials(invoice, company.id);
    const result = await this.providers.resolve(invoice.environment).cancel({
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      accessKey: invoice.accessKey,
      environment: invoice.environment,
      pfxBuffer: credentials.pfxBuffer,
      p12Password: credentials.password,
      emitenteCnpj: company.taxId,
      reason: reason.code,
      description: reason.description,
    });
    if (result.status === 'pending')
      throw new Error(`Cancellation pending at Sefin: ${result.errorMessage}`);
    if (result.status === 'cancelled') {
      await this.lifecycle.transition(invoice, invoice.confirmCancellation());
      await this.webhooks.publish(invoice, 'nfse.invoice.cancelled', {
        reason: reason.code,
      });
      return;
    }
    await this.lifecycle.transition(
      invoice,
      invoice.rejectCancellation(result.errorCode, result.errorMessage),
    );
    await this.webhooks.publish(invoice, 'nfse.invoice.cancellation_rejected', {
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    });
  }

  private credentials(
    invoice: Invoice,
    companyId: string,
  ): Promise<{ pfxBuffer: Buffer; password: string }> {
    return invoice.environment === 'live'
      ? this.certificates.decryptCredentials(
          companyId,
          invoice.tenantId,
          invoice.environment,
        )
      : Promise.resolve({ pfxBuffer: Buffer.alloc(0), password: '' });
  }
}
