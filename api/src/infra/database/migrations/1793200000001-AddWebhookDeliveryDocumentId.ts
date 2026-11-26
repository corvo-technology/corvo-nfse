import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which NF-e a webhook delivery is about, so the document page can list its notices. Null for
 * NFS-e events (they keep `invoice_id`) and for events without a document.
 */
export class AddWebhookDeliveryDocumentId1793200000001 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.webhook_deliveries ADD COLUMN document_id uuid`,
    );
    await runner.query(
      `CREATE INDEX idx_webhook_deliveries_document ON ${s}.webhook_deliveries (tenant_id, document_id, created_at DESC, id DESC) WHERE document_id IS NOT NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`DROP INDEX ${s}.idx_webhook_deliveries_document`);
    await runner.query(
      `ALTER TABLE ${s}.webhook_deliveries DROP COLUMN document_id`,
    );
  }
}
