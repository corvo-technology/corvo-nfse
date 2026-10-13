import 'dotenv/config';
import Stripe from 'stripe';
import { PricingService } from '../src/modules/plans/application/pricing.service';
import { BILLING_API_VERSION } from '../src/infra/external/stripe/stripe.gateway';
import { SUPPORTED_STRIPE_EVENTS } from '../src/modules/billing/domain/stripe-webhook-events';

/** Explicit operator command. Never provisions or changes a Stripe account during application boot. */
async function provision() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required');
  const stripe = new Stripe(key, {
    apiVersion: BILLING_API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 1,
  });
  const pricing = new PricingService();
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
    product ??= await stripe.products.create(
      { name: `Corvo ${quote.name}`, metadata: { corvo_product: productKey } },
      { idempotencyKey: productKey },
    );
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
    meter ??= await stripe.billing.meters.create(
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
          : existing.recurring.meter === meter.id);
      if (matches) await stripe.prices.update(existing.id, { metadata });
      else {
        await stripe.prices.create(
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
                : { interval: 'month', usage_type: 'metered', meter: meter.id },
          },
          { idempotencyKey: `${lookup}:${amount}:${existing?.id ?? 'new'}` },
        );
        if (existing)
          await stripe.prices.update(existing.id, { active: false });
      }
    }
  }
  const returnUrl =
    process.env.STRIPE_CHECKOUT_CANCEL_URL ??
    'http://localhost:3001/app/billing/cancel';
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
    default_return_url: returnUrl,
    business_profile: { headline: 'Gerenciar cobrança Corvo' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
    },
  };
  portal = portal
    ? await stripe.billingPortal.configurations.update(portal.id, portalParams)
    : await stripe.billingPortal.configurations.create(portalParams, {
        idempotencyKey: portalKey,
      });
  process.stdout.write(`STRIPE_PORTAL_CONFIGURATION_ID=${portal.id}\n`);
  const webhookUrl = process.argv
    .find((a) => a.startsWith('--webhook-url='))
    ?.slice('--webhook-url='.length);
  if (webhookUrl) {
    const events = Array.from(
      SUPPORTED_STRIPE_EVENTS,
    ) as Stripe.WebhookEndpointCreateParams.EnabledEvent[];
    const existing = (
      await stripe.webhookEndpoints.list({ limit: 100 })
    ).data.find((e) => e.url === webhookUrl);
    if (existing)
      await stripe.webhookEndpoints.update(existing.id, {
        enabled_events: events,
      });
    else {
      const endpoint = await stripe.webhookEndpoints.create(
        {
          url: webhookUrl,
          enabled_events: events,
          api_version: BILLING_API_VERSION,
        },
        { idempotencyKey: `corvo:webhook:${webhookUrl}` },
      );
      process.stdout.write(
        `STRIPE_PLATFORM_WEBHOOK_SECRET=${endpoint.secret}\n`,
      );
    }
  }
  process.stdout.write(
    'Configure Stripe retries, receipts and branding in the Dashboard. Prices are BRL/month; overage is charged per authorized processing.\n',
  );
}
void provision().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
