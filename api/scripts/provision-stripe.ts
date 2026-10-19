import 'dotenv/config';
import Stripe from 'stripe';
import { PricingService } from '../src/modules/plans/application/pricing.service';
import { BILLING_API_VERSION } from '../src/infra/external/stripe/stripe.gateway';
import { SUPPORTED_STRIPE_EVENTS } from '../src/modules/billing/domain/stripe-webhook-events';

export interface ProvisionOptions {
  /** Mutating calls run only when true. Defaults to a read-only dry run. */
  apply: boolean;
  webhookUrl?: string;
  returnUrl?: string;
}

export interface ProvisionSummaryRow {
  planSlug: string;
  lookupKey: string;
  priceId: string;
  amount: number;
  meterId: string;
}

/** Throws if a live secret key is used without an explicit --live flag. Never logs the key itself. */
export function assertKeySafety(
  key: string,
  flags: { apply: boolean; live: boolean },
): void {
  const isLiveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  if (isLiveKey && flags.apply && !flags.live)
    throw new Error(
      'Refusing to apply against a live Stripe key without --live. Re-run with --apply --live to provision production.',
    );
}

/**
 * Provisions the paid plans (free excluded). Stripe products, prices and meters
 * that do not belong to the current catalog are never read, created, updated or
 * deactivated here.
 */
export async function provisionStripe(
  stripe: Stripe,
  options: ProvisionOptions,
): Promise<ProvisionSummaryRow[]> {
  const pricing = new PricingService();
  const summary: ProvisionSummaryRow[] = [];

  for (const quote of pricing
    .listAllQuotes('monthly')
    .filter((p) => p.basePriceCents > 0)) {
    const productKey = `corvo:${quote.slug}`;
    let product: Stripe.Product | undefined;
    for await (const candidate of stripe.products.list({ limit: 100 })) {
      if (candidate.metadata.corvo_product === productKey) {
        product = candidate;
        break;
      }
    }
    if (!product && options.apply) {
      product = await stripe.products.create(
        {
          name: `Corvo ${quote.name}`,
          metadata: { corvo_product: productKey },
        },
        { idempotencyKey: productKey },
      );
    }

    const eventName = `corvo_${quote.slug}_overage`;
    let meter: Stripe.Billing.Meter | undefined;
    for await (const candidate of stripe.billing.meters.list({
      status: 'active',
      limit: 100,
    })) {
      if (candidate.event_name === eventName) {
        meter = candidate;
        break;
      }
    }
    if (!meter && options.apply) {
      meter = await stripe.billing.meters.create(
        {
          display_name: `Corvo ${quote.name} excedente`,
          event_name: eventName,
          default_aggregation: { formula: 'sum' },
          customer_mapping: {
            event_payload_key: 'stripe_customer_id',
            type: 'by_id',
          },
          value_settings: { event_payload_key: 'value' },
        },
        { idempotencyKey: `corvo:meter:${quote.slug}` },
      );
    }

    for (const kind of ['base', 'overage'] as const) {
      const lookup = `corvo_${quote.slug}_${kind === 'base' ? 'monthly' : 'overage'}`;
      const amount =
        kind === 'base' ? quote.basePriceCents : quote.perCreditOverageCents;
      const metadata = {
        plan_slug: quote.slug,
        kind,
        included: String(quote.monthlyAllowance),
        version: '1',
      };
      const existing = (
        await stripe.prices.list({ lookup_keys: [lookup], limit: 100 })
      ).data.find((p) => p.lookup_key === lookup);
      const matches =
        existing?.active &&
        existing.currency === 'brl' &&
        existing.unit_amount === amount &&
        existing.recurring?.interval === 'month' &&
        (kind === 'base'
          ? existing.recurring.usage_type === 'licensed'
          : existing.recurring.meter === meter?.id);

      let priceId = existing?.id ?? 'would create';
      if (options.apply) {
        if (matches) {
          await stripe.prices.update(existing.id, { metadata });
        } else {
          if (!product)
            throw new Error(`Missing Stripe product for ${quote.slug}`);
          const created = await stripe.prices.create(
            {
              product: product.id,
              currency: 'brl',
              unit_amount: amount,
              tax_behavior: 'unspecified',
              metadata,
              lookup_key: lookup,
              transfer_lookup_key: true,
              recurring:
                kind === 'base'
                  ? { interval: 'month' }
                  : {
                      interval: 'month',
                      usage_type: 'metered',
                      meter: meter!.id,
                    },
            },
            { idempotencyKey: `${lookup}:${amount}:${existing?.id ?? 'new'}` },
          );
          priceId = created.id;
          if (existing)
            await stripe.prices.update(existing.id, { active: false });
        }
      } else if (matches) {
        priceId = existing.id;
      } else if (existing) {
        priceId = `would replace ${existing.id}`;
      }

      summary.push({
        planSlug: quote.slug,
        lookupKey: lookup,
        priceId,
        amount,
        meterId: meter?.id ?? (options.apply ? 'n/a' : 'would create'),
      });
    }
  }

  const portalKey = 'corvo_monthly_billing';
  let portal: Stripe.BillingPortal.Configuration | undefined;
  for await (const candidate of stripe.billingPortal.configurations.list({
    limit: 100,
  })) {
    if (candidate.metadata?.corvo_configuration === portalKey) {
      portal = candidate;
      break;
    }
  }
  const portalParams: Stripe.BillingPortal.ConfigurationCreateParams = {
    metadata: { corvo_configuration: portalKey },
    default_return_url:
      options.returnUrl ?? 'http://localhost:3001/app/billing/cancel',
    business_profile: { headline: 'Gerenciar cobrança Corvo' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
    },
  };
  if (options.apply) {
    portal = portal
      ? await stripe.billingPortal.configurations.update(
          portal.id,
          portalParams,
        )
      : await stripe.billingPortal.configurations.create(portalParams, {
          idempotencyKey: portalKey,
        });
    process.stdout.write(`STRIPE_PORTAL_CONFIGURATION_ID=${portal.id}\n`);
  } else {
    process.stdout.write(
      portal
        ? `Would update portal configuration ${portal.id}\n`
        : 'Would create a new portal configuration\n',
    );
  }

  if (options.webhookUrl) {
    const events = Array.from(
      SUPPORTED_STRIPE_EVENTS,
    ) as Stripe.WebhookEndpointCreateParams.EnabledEvent[];
    const existing = (
      await stripe.webhookEndpoints.list({ limit: 100 })
    ).data.find((e) => e.url === options.webhookUrl);
    if (options.apply) {
      if (existing)
        await stripe.webhookEndpoints.update(existing.id, {
          enabled_events: events,
        });
      else {
        const endpoint = await stripe.webhookEndpoints.create(
          {
            url: options.webhookUrl,
            enabled_events: events,
            api_version: BILLING_API_VERSION,
          },
          { idempotencyKey: `corvo:webhook:${options.webhookUrl}` },
        );
        process.stdout.write(
          `STRIPE_PLATFORM_WEBHOOK_SECRET=${endpoint.secret}\n`,
        );
      }
    } else {
      process.stdout.write(
        existing
          ? `Would update webhook endpoint ${existing.id}\n`
          : `Would create a webhook endpoint for ${options.webhookUrl}\n`,
      );
    }
  }

  return summary;
}

function printSummaryTable(summary: ProvisionSummaryRow[]): void {
  process.stdout.write(
    '\nplan_slug         lookup_key                      price_id                 amount  meter_id\n',
  );
  for (const row of summary) {
    process.stdout.write(
      `${row.planSlug.padEnd(18)}${row.lookupKey.padEnd(32)}${row.priceId.padEnd(25)}${String(row.amount).padEnd(8)}${row.meterId}\n`,
    );
  }
}

/** Explicit operator command. Never provisions or changes a Stripe account during application boot. */
async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required');
  const apply = process.argv.includes('--apply');
  const live = process.argv.includes('--live');
  assertKeySafety(key, { apply, live });
  if (!apply)
    process.stdout.write(
      'DRY RUN: reading current Stripe state only. Pass --apply to provision.\n',
    );
  const stripe = new Stripe(key, {
    apiVersion: BILLING_API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 1,
  });
  const webhookUrl = process.argv
    .find((a) => a.startsWith('--webhook-url='))
    ?.slice('--webhook-url='.length);
  const summary = await provisionStripe(stripe, {
    apply,
    webhookUrl,
    returnUrl: process.env.STRIPE_CHECKOUT_CANCEL_URL,
  });
  printSummaryTable(summary);
  process.stdout.write(
    'Configure Stripe retries, receipts and branding in the Dashboard. Prices are BRL/month; overage is charged per authorized processing.\n',
  );
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
