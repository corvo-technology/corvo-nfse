export const ACCOUNT_NOTICE = 'account.notice';

/** Something the workspace's admins should hear about by e-mail. Live only: callers never publish test activity. */
export type AccountNotice =
  | { kind: 'credits-added'; units: number }
  | { kind: 'invoice-rejected'; invoiceId: string; reason: string }
  | { kind: 'api-key-created'; name: string }
  | { kind: 'mcp-connected'; clientName: string }
  | { kind: 'credits-exhausted' }
  // A webhook delivery gave up after every retry. Never carries the url, secret or body.
  | {
      kind: 'webhook-delivery-failed';
      webhookConfigId: string;
      eventType: string;
    }
  | { kind: 'payment-failed' }
  | { kind: 'pix-expired' }
  | { kind: 'payment-mismatch' }
  | { kind: 'subscription-canceled' }
  | {
      kind: 'member-invited';
      email: string;
      /** The invitee's name, as the admin typed it. */
      name: string;
      role: string;
      /** Single-use secret for the accept link. Lives only in this in-process event. */
      token: string;
      inviterName?: string;
    }
  | { kind: 'member-joined'; name: string; email: string; role: string }
  | {
      kind: 'accountant-package-failed';
      companyId: string;
      companyName: string;
      /** YYYY-MM */
      month: string;
    }
  | {
      kind: 'accountant-package-empty';
      companyId: string;
      companyName: string;
      /** YYYY-MM */
      month: string;
    }
  | {
      kind: 'accountant-package-too-large';
      companyId: string;
      companyName: string;
      /** YYYY-MM */
      month: string;
      count: number;
      limit: number;
    }
  | {
      kind: 'certificate-expiring';
      companyId: string;
      companyName: string;
      /** 30 or 7 days left, or 0 once it has expired. */
      stage: 30 | 7 | 0;
      validUntil: Date;
    }
  // What the national portal registered about an invoice after it was authorized.
  | {
      kind: 'invoice-cancelled-on-portal';
      invoiceId: string;
      nfseNumber: number | null;
      reason: string | null;
    }
  | {
      kind: 'invoice-rejected-by-taker';
      invoiceId: string;
      nfseNumber: number | null;
      reason: string | null;
    }
  // An NFC-e issued off-line is 20 hours old and was not transmitted yet (the limit is 24 hours).
  | {
      kind: 'nfce-contingency-deadline';
      documentId: string;
      number: number | null;
      deadlineAt: Date;
    }
  | {
      kind: 'invoice-blocked-on-portal';
      invoiceId: string;
      nfseNumber: number | null;
    };

export type AccountNoticeEvent = {
  name: typeof ACCOUNT_NOTICE;
  tenantId: string;
  notice: AccountNotice;
};

export function accountNotice(
  tenantId: string,
  notice: AccountNotice,
): AccountNoticeEvent {
  return { name: ACCOUNT_NOTICE, tenantId, notice };
}
