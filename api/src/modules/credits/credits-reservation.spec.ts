import {
  CreditTransaction,
  CreditTransactionType,
} from './domain/credit-transaction';

describe('CreditTransaction - Reservation Flow', () => {
  describe('reserveCredit', () => {
    it('creates a reservation transaction with negative amount', () => {
      const reservation = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: -1, // negative for reservation
        type: 'message_sent',
        description: 'Invoice emission reservation',
        channelSlug: 'whatsapp',
        createdAt: new Date(),
        isReservation: true,
        reservedInvoiceId: 'invoice-456',
      });

      expect(reservation.amount).toBe(-1);
      expect(reservation.tenantId).toBe('tenant-123');
      expect(reservation.type).toBe('message_sent');
      expect(reservation.channelSlug).toBe('whatsapp');
      expect(reservation.reservedInvoiceId).toBe('invoice-456');
      expect(reservation.isReservation).toBe(true);
    });

    it('throws when creating reservation with zero amount', () => {
      expect(() =>
        CreditTransaction.create({
          tenantId: 'tenant-123',
          amount: 0,
          type: 'message_sent',
          description: 'Invalid zero reservation',
          createdAt: new Date(),
        }),
      ).toThrow('CreditTransaction amount must be non-zero');
    });
  });

  describe('confirmReservation', () => {
    it('transforms reservation into confirmed debit', () => {
      const reservation = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: -1,
        type: 'message_sent',
        description: 'Invoice emission reservation',
        channelSlug: 'whatsapp',
        createdAt: new Date(),
        isReservation: true,
        reservedInvoiceId: 'invoice-456',
      });

      // Confirming: create a new transaction marking the reservation as confirmed
      const confirmed = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: -1,
        type: 'message_sent',
        description: 'Invoice emission confirmed',
        channelSlug: 'whatsapp',
        createdAt: new Date(),
        isReservation: false,
        relatedTransactionId: reservation.id,
        reservedInvoiceId: 'invoice-456',
      });

      expect(confirmed.amount).toBe(-1);
      expect(confirmed.relatedTransactionId).toBe(reservation.id);
      expect(confirmed.reservedInvoiceId).toBe('invoice-456');
      expect(confirmed.isReservation).toBe(false);
    });
  });

  describe('refundReservation', () => {
    it('creates a refund transaction for cancelled reservation', () => {
      const reservation = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: -1,
        type: 'message_sent',
        description: 'Invoice emission reservation',
        channelSlug: 'whatsapp',
        createdAt: new Date(),
        isReservation: true,
        reservedInvoiceId: 'invoice-456',
      });

      // Refund: positive amount to reverse the reservation
      const refund = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: 1, // positive refund
        type: 'refund',
        description: 'Invoice rejected - credit refunded',
        source: 'bonus',
        createdAt: new Date(),
        relatedTransactionId: reservation.id,
        reservedInvoiceId: 'invoice-456',
      });

      expect(refund.amount).toBe(1);
      expect(refund.type).toBe('refund');
      expect(refund.relatedTransactionId).toBe(reservation.id);
    });

    it('preserves full audit trail', () => {
      const original = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: -1,
        type: 'message_sent',
        description: 'Invoice emission reservation',
        channelSlug: 'whatsapp',
        createdAt: new Date(),
        isReservation: true,
        reservedInvoiceId: 'invoice-456',
      });

      const refund = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: 1,
        type: 'refund',
        description: 'Invoice rejected - credit refunded',
        source: 'bonus',
        createdAt: new Date(),
        relatedTransactionId: original.id,
        reservedInvoiceId: original.reservedInvoiceId,
      });

      expect(refund.reservedInvoiceId).toBe(original.reservedInvoiceId);
    });
  });

  describe('toSnapshot', () => {
    it('preserves all reservation fields in snapshot', () => {
      const tx = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: -1,
        type: 'message_sent',
        description: 'Invoice emission reservation',
        channelSlug: 'whatsapp',
        createdAt: new Date(),
        isReservation: true,
        reservedInvoiceId: 'invoice-456',
      });

      const snapshot = tx.toSnapshot();

      expect(snapshot.tenantId).toBe('tenant-123');
      expect(snapshot.amount).toBe(-1);
      expect(snapshot.type).toBe('message_sent');
      expect(snapshot.channelSlug).toBe('whatsapp');
      expect(snapshot.isReservation).toBe(true);
      expect(snapshot.reservedInvoiceId).toBe('invoice-456');
    });

    it('returns a copy, not the original', () => {
      const tx = CreditTransaction.create({
        tenantId: 'tenant-123',
        amount: -1,
        type: 'message_sent',
        createdAt: new Date(),
      });

      const snapshot = tx.toSnapshot();
      snapshot.amount = 999;

      expect(tx.amount).toBe(-1);
    });
  });

  describe('reconstitute', () => {
    it('reconstitutes reservation from props', () => {
      const props = {
        id: 'tx-123',
        tenantId: 'tenant-123',
        amount: -1,
        type: 'message_sent' as CreditTransactionType,
        description: 'Invoice emission reservation',
        channelSlug: 'whatsapp',
        createdAt: new Date('2026-10-01'),
        isReservation: true,
        reservedInvoiceId: 'invoice-456',
      };

      const tx = CreditTransaction.reconstitute(props);

      expect(tx.id).toBe('tx-123');
      expect(tx.amount).toBe(-1);
      expect(tx.type).toBe('message_sent');
      expect(tx.channelSlug).toBe('whatsapp');
      expect(tx.isReservation).toBe(true);
      expect(tx.reservedInvoiceId).toBe('invoice-456');
    });
  });
});
