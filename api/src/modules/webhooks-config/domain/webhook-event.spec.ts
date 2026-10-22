import { PUBLIC_WEBHOOK_EVENT_TYPES, WebhookEventType } from './webhook-event';

describe('WebhookEvent Types', () => {
  describe('NFS-e Webhook Event Types', () => {
    it('includes nfse.invoice.authorized', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain('nfse.invoice.authorized');
    });

    it('includes nfse.invoice.rejected', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain('nfse.invoice.rejected');
    });

    it('includes nfse.invoice.failed', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain('nfse.invoice.failed');
    });

    it('includes nfse.invoice.reconciliation_required', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain(
        'nfse.invoice.reconciliation_required',
      );
    });

    it('includes nfse.invoice.manual_review', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain(
        'nfse.invoice.manual_review',
      );
    });

    it('includes nfse.invoice.email_sent', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain('nfse.invoice.email_sent');
    });

    it('includes the cancellation event types', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain('nfse.invoice.cancelled');
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain(
        'nfse.invoice.cancellation_rejected',
      );
    });

    it('includes nfse.invoice.fiscal_discrepancy', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain(
        'nfse.invoice.fiscal_discrepancy',
      );
    });

    it('includes the eleven supported NFS-e event types', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toHaveLength(11);
    });

    it('all NFS-e event types follow the nfse.invoice.* pattern', () => {
      for (const eventType of PUBLIC_WEBHOOK_EVENT_TYPES) {
        expect(eventType).toMatch(/^nfse\.invoice\./);
      }
    });
  });

  describe('WebhookEventType union', () => {
    it('nfse.invoice.authorized is a valid WebhookEventType', () => {
      const eventType: WebhookEventType = 'nfse.invoice.authorized';
      expect(eventType).toBe('nfse.invoice.authorized');
    });

    it('nfse.invoice.rejected is a valid WebhookEventType', () => {
      const eventType: WebhookEventType = 'nfse.invoice.rejected';
      expect(eventType).toBe('nfse.invoice.rejected');
    });

    it('nfse.invoice.failed is a valid WebhookEventType', () => {
      const eventType: WebhookEventType = 'nfse.invoice.failed';
      expect(eventType).toBe('nfse.invoice.failed');
    });

    it('nfse.invoice.reconciliation_required is a valid WebhookEventType', () => {
      const eventType: WebhookEventType =
        'nfse.invoice.reconciliation_required';
      expect(eventType).toBe('nfse.invoice.reconciliation_required');
    });

    it('nfse.invoice.manual_review is a valid WebhookEventType', () => {
      const eventType: WebhookEventType = 'nfse.invoice.manual_review';
      expect(eventType).toBe('nfse.invoice.manual_review');
    });
  });
});
