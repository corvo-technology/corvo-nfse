import type Stripe from 'stripe';

/**
 * Corvo look for the Stripe Checkout page, sent with every session so it does not
 * depend on the account's dashboard branding (olive green by default).
 * Colors follow the product: near-black background and mint accent.
 */
const BRAND_LOGO_URL =
  'https://assets.greenflow.solutions/brand/corvo-faceted-green.png';

export const CHECKOUT_BRANDING: Stripe.Checkout.SessionCreateParams.BrandingSettings =
  {
    display_name: 'Corvo',
    background_color: '#0a0a0a',
    button_color: '#3fd6a8',
    border_style: 'rounded',
    font_family: 'inter',
    logo: { type: 'url', url: BRAND_LOGO_URL },
    icon: { type: 'url', url: BRAND_LOGO_URL },
  };
