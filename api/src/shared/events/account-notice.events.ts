export const ACCOUNT_NOTICE = 'account.notice';

/** Something the workspace's admins should hear about by e-mail. Live only: callers never publish test activity. */
export type AccountNotice =
  | { kind: 'credits-added'; units: number }
  | { kind: 'invoice-rejected'; invoiceId: string; reason: string }
  | { kind: 'api-key-created'; name: string }
  | { kind: 'mcp-connected'; clientName: string };

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
