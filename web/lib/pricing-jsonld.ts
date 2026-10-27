import { PLANS } from "@/lib/plans-catalog";
import { pageUrl } from "@/lib/seo";

/** One Offer per paid plan, from the same catalog the pricing cards use; overage as an extra UnitPriceSpecification. */
export function paidPlanOffers(locale: "pt" | "en") {
  return PLANS.filter((plan) => plan.basePriceCents > 0).map((plan) => ({
    "@type": "Offer",
    name: plan.slug.charAt(0).toUpperCase() + plan.slug.slice(1),
    price: (plan.basePriceCents / 100).toFixed(2),
    priceCurrency: "BRL",
    url: pageUrl(locale),
    priceSpecification: [
      {
        "@type": "UnitPriceSpecification",
        price: (plan.perCreditCents / 100).toFixed(2),
        priceCurrency: "BRL",
        unitText: "nota excedente",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1 },
      },
    ],
  }));
}
