import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BillingRepository } from '../domain/billing.repository';
import { BillingProvider } from '../domain/billing-provider.port';
import { BillingPeriod } from '../domain/billing-period';

@Injectable()
export class OverageReportService {
  private readonly logger = new Logger(OverageReportService.name);
  constructor(
    private readonly discovery: TenantWorkDiscovery,
    private readonly repository: BillingRepository,
    private readonly provider: BillingProvider,
  ) {}
  async report() {
    if (!this.provider.enabled) return;
    await this.discovery.visit('billing-report', async (tenantId) => {
      for (const period of await this.repository.reportablePeriods(tenantId)) {
        try {
          await this.reportPeriod(period.tenantId, period.id);
        } catch (error: unknown) {
          this.logger.error({
            event: 'overage_reporting_failed',
            periodId: period.id,
            error,
          });
        }
      }
    });
  }
  async reportPeriod(tenantId: string, periodId: string) {
    // Pin the complete request in its own transaction BEFORE sending to the provider.
    await this.repository.locked(tenantId, async () => {
      const state = await this.repository.period(periodId, tenantId);
      if (
        !state ||
        state.pendingReport ||
        !state.customerId ||
        !state.subscriptionId
      )
        return;
      const excess = new BillingPeriod(state).summary.overage_units;
      if (excess <= state.reported) return;
      state.pendingReport = {
        id: randomUUID(),
        from: state.reported,
        to: excess,
        route: null,
        invoiceId: null,
        timestamp: Math.floor(
          Math.min(Date.now(), state.periodEnd.getTime() - 1000) / 1000,
        ),
        attemptedAt: null,
        createdAt: new Date().toISOString(),
      };
      await this.repository.savePeriod(state, tenantId);
    });
    await this.repository.locked(tenantId, async () => {
      const state = await this.repository.period(periodId, tenantId);
      const pending = state?.pendingReport;
      if (!state?.subscriptionId || !pending || pending.route) return;
      const route = await this.provider.reportRoute(
        state.subscriptionId,
        state.periodEnd,
      );
      pending.route = route.route;
      pending.invoiceId = route.invoiceId;
      if (Date.now() / 1000 - pending.timestamp > 35 * 86400)
        pending.route = 'invoice_item';
      await this.repository.savePeriod(state, tenantId);
    });
    // Persist first attempt time independently, so long outages cannot silently replay an ambiguous meter call.
    await this.repository.locked(tenantId, async () => {
      const state = await this.repository.period(periodId, tenantId);
      if (state?.pendingReport && !state.pendingReport.attemptedAt) {
        state.pendingReport.attemptedAt = new Date().toISOString();
        await this.repository.savePeriod(state, tenantId);
      }
    });
    await this.repository.locked(tenantId, async () => {
      const state = await this.repository.period(periodId, tenantId);
      const pending = state?.pendingReport;
      if (!state?.customerId || !state.meterEventName || !pending) return;
      if (pending.route === 'meter') {
        if (
          Date.now() - new Date(pending.attemptedAt!).getTime() >
          23 * 3600_000
        ) {
          // Stripe guarantees meter dedupe for only 24h. Never risk a second charge after an ambiguous long outage.
          throw new Error(
            `Meter report ${pending.id} needs reconciliation before retrying outside the dedupe window`,
          );
        }
        await this.provider.reportMeter({
          id: pending.id,
          name: state.meterEventName,
          customerId: state.customerId,
          units: pending.to - pending.from,
          timestamp: pending.timestamp,
        });
      } else if (pending.route === 'invoice_item') {
        await this.provider.reportInvoiceItem({
          id: pending.id,
          customerId: state.customerId,
          invoiceId: pending.invoiceId,
          units: pending.to - pending.from,
          unitCents: state.unitCents,
          periodStart: state.periodStart,
          periodEnd: state.periodEnd,
        });
      } else throw new Error('Usage report route not selected');
      const period = new BillingPeriod(state);
      period.finishReport();
      await this.repository.savePeriod(period.state, tenantId);
    });
  }
}
