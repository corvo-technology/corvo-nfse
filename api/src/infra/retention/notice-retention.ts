import type { RetentionRule } from './data-retention';

export const WEBHOOK_DELIVERY_SENT_KEEP_DAYS = 30;
export const WEBHOOK_DELIVERY_FAILED_KEEP_DAYS = 90;
export const INBOUND_NOTICE_KEEP_DAYS = 30;
export const INTEGRATION_OPERATION_KEEP_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cleanup of the notices Corvo sends to a customer's system and of the notices platforms send to Corvo.
 * `schema` is already escaped for SQL. Rules that "erase" keep the row and every key that recognises a
 * repeated notice; only the content goes.
 *
 * Outgoing (`webhook_deliveries`, one row per notice, updated on each attempt):
 *  - `sent` after 30 days: `payload` (the event body) and `response_body` are emptied. The row stays with
 *    event, status, attempts, HTTP code, invoice and dates, so the list and the MCP tool keep working.
 *    Retry reads the payload, so a row without it is refused with WEBHOOK_DELIVERY_CONTENT_ERASED
 *    (webhook-outbox.service.ts, manualRetry). The `payload IS NULL` itself is the mark: every row is
 *    inserted with a payload.
 *  - `failed` (final) after 90 days: the row is deleted. Between 30 and 90 days it keeps its payload so
 *    the owner can still retry it. `pending`, `delayed` and `manual_retry` are never touched.
 *
 * Incoming:
 *  - `webhook_events` (Stripe/Woovi inbox): `processed` and `ignored` after 30 days lose `payload`. The row
 *    keeps (provider, provider_event_id) and `payload_sha256`, which is what recognises a replay.
 *    `failed`, `manual_review`, `received`, `processing` are not final and keep their payload.
 *  - `integration_events` (sales platforms): `processed` and `ignored` after 30 days get `payload_enc = ''`
 *    (the column is NOT NULL). `delivery_id` and the unique key stay, so a redelivery is still a duplicate.
 *    `needs_attention`, `dead`, `retry_pending`, `received`, `processing` keep their body for a retry.
 *  - `integration_operations` (one per sale): only terminal ones after 90 days, i.e. the invoice was
 *    issued and nothing is pending on it (`submitted`, no block reason), or the owner chose to ignore the
 *    sale. A sale that waits for the owner (needs_attention), is blocked for another reason,
 *    has `refund_after_invoice`, `cancel_requested` or `cancel_failed`, is never touched. The buyer
 *    (name, tax id, e-mail, address), the description, the service/e-mail overrides and the frozen
 *    `emission_request` are erased. Kept: operation_key, idempotency_key, emission_request_hash, invoice_id,
 *    states, and in the snapshot `externalRefs` (a later refund finds its sale by them), `commercialState`,
 *    dates, amount, currency, `sellerIssuesInvoice` and `items` with only product id and quantity
 *    (cancel-on-refund picks its rule by product id). `"erased": true` in the snapshot marks the row.
 *    For a terminal sale a late refund goes to the "after invoice" path, which needs none of the erased data.
 */
export function noticeRetentionRules(
  schema: string,
  now = new Date(),
): RetentionRule[] {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const deliveries = `${schema}.webhook_deliveries`;
  const webhookEvents = `${schema}.webhook_events`;
  const integrationEvents = `${schema}.integration_events`;
  const operations = `${schema}.integration_operations`;
  return [
    {
      table: deliveries,
      rule: `sent notice older than ${WEBHOOK_DELIVERY_SENT_KEEP_DAYS} days: erase body and answer`,
      where: `status = 'sent' AND created_at < $1 AND (payload IS NOT NULL OR response_body IS NOT NULL)`,
      params: [before(WEBHOOK_DELIVERY_SENT_KEEP_DAYS)],
      erase: 'payload = NULL, response_body = NULL',
    },
    {
      table: deliveries,
      rule: `failed notice older than ${WEBHOOK_DELIVERY_FAILED_KEEP_DAYS} days: delete`,
      where: `status = 'failed' AND created_at < $1`,
      params: [before(WEBHOOK_DELIVERY_FAILED_KEEP_DAYS)],
    },
    {
      table: webhookEvents,
      rule: `payment notice processed or ignored more than ${INBOUND_NOTICE_KEEP_DAYS} days ago: erase payload`,
      where: `status IN ('processed','ignored') AND processed_at < $1 AND payload IS NOT NULL`,
      params: [before(INBOUND_NOTICE_KEEP_DAYS)],
      erase: 'payload = NULL',
    },
    {
      table: integrationEvents,
      rule: `platform notice processed or ignored more than ${INBOUND_NOTICE_KEEP_DAYS} days ago: erase body`,
      where: `state IN ('processed','ignored') AND updated_at < $1 AND payload_enc <> ''`,
      params: [before(INBOUND_NOTICE_KEEP_DAYS)],
      erase: `payload_enc = ''`,
    },
    {
      table: operations,
      rule: `finished sale untouched for ${INTEGRATION_OPERATION_KEEP_DAYS} days: erase buyer and raw data`,
      where: `updated_at < $1
        AND snapshot->>'erased' IS DISTINCT FROM 'true'
        AND ((invoice_id IS NOT NULL AND fiscal_status = 'submitted' AND block_reason IS NULL)
          OR block_reason = 'ignored_by_user')`,
      params: [before(INTEGRATION_OPERATION_KEEP_DAYS)],
      erase: `emission_request = NULL, snapshot = jsonb_build_object(
        'operationKey', snapshot->'operationKey',
        'commercialState', snapshot->'commercialState',
        'externalRefs', COALESCE(snapshot->'externalRefs', '{}'::jsonb),
        'occurredAt', snapshot->'occurredAt',
        'paidAt', snapshot->'paidAt',
        'currency', snapshot->'currency',
        'amountCents', snapshot->'amountCents',
        'discountCents', snapshot->'discountCents',
        'sellerIssuesInvoice', snapshot->'sellerIssuesInvoice',
        'customer', 'null'::jsonb,
        'items', CASE WHEN jsonb_typeof(snapshot->'items') = 'array' THEN
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'externalProductId', item->'externalProductId',
            'description', 'null'::jsonb,
            'quantity', item->'quantity'))
            FROM jsonb_array_elements(snapshot->'items') AS item), '[]'::jsonb)
          ELSE '[]'::jsonb END,
        'erased', true)`,
    },
  ];
}
