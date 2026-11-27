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

    it('includes the taker rejection reported by the portal', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).toContain(
        'nfse.invoice.taker_rejected',
      );
    });

    it('includes the twelve supported NFS-e event types', () => {
      expect(
        PUBLIC_WEBHOOK_EVENT_TYPES.filter((type) => type.startsWith('nfse.')),
      ).toHaveLength(12);
    });

    it('all NFS-e event types follow the nfse.invoice.* pattern', () => {
      for (const eventType of PUBLIC_WEBHOOK_EVENT_TYPES.filter((type) =>
        type.startsWith('nfse.'),
      )) {
        expect(eventType).toMatch(/^nfse\.invoice\./);
      }
    });

    it('the NF-e events are only an addition: nfe.document.* and nfe.inutilization.*', () => {
      const nfe = PUBLIC_WEBHOOK_EVENT_TYPES.filter((type) =>
        type.startsWith('nfe.'),
      );
      expect(nfe).toHaveLength(14);
      for (const eventType of nfe)
        expect(eventType).toMatch(/^nfe\.(document|inutilization)\./);
    });
  });

  describe('NFC-e Webhook Event Types', () => {
    it('adds the nfce.* events and keeps every older one first, in the same order', () => {
      const nfce = PUBLIC_WEBHOOK_EVENT_TYPES.filter((type) =>
        type.startsWith('nfce.'),
      );
      expect(nfce).toEqual([
        'nfce.document.authorized',
        'nfce.document.rejected',
        'nfce.document.denied',
        'nfce.document.failed',
        'nfce.document.reconciliation_required',
        'nfce.document.manual_review',
        'nfce.document.documents_ready',
        'nfce.document.email_sent',
        'nfce.document.email_failed',
        'nfce.document.cancelled',
        'nfce.document.cancellation_rejected',
        'nfce.inutilization.completed',
        'nfce.inutilization.rejected',
        'nfce.contingency.deadline_near',
      ]);
      const older = PUBLIC_WEBHOOK_EVENT_TYPES.slice(0, 26);
      expect(older.every((type) => !type.startsWith('nfce.'))).toBe(true);
      expect(older[0]).toBe('nfse.invoice.authorized');
      expect(older[25]).toBe('nfe.inutilization.rejected');
    });

    it('has no correction letter event for the NFC-e', () => {
      expect(PUBLIC_WEBHOOK_EVENT_TYPES).not.toContain(
        'nfce.document.corrected',
      );
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
