import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Which invoice a webhook delivery is about, so the invoice page can list its notices. Null for events without an invoice. */
export class AddWebhookDeliveryInvoiceId1792970000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.webhook_deliveries ADD COLUMN invoice_id uuid`,
    );
    // Old rows keep the invoice only inside the event body.
    await runner.query(
      `UPDATE ${s}.webhook_deliveries
          SET invoice_id = (payload->'data'->>'invoiceId')::uuid
        WHERE payload->'data'->>'invoiceId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    );
    await runner.query(
      `CREATE INDEX idx_webhook_deliveries_invoice ON ${s}.webhook_deliveries (tenant_id, invoice_id, created_at DESC, id DESC) WHERE invoice_id IS NOT NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`DROP INDEX ${s}.idx_webhook_deliveries_invoice`);
    await runner.query(
      `ALTER TABLE ${s}.webhook_deliveries DROP COLUMN invoice_id`,
    );
  }
}
