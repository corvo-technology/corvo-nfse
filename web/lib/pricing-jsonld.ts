import { PLANS } from "@/lib/plans-catalog";
import { pageUrl } from "@/lib/seo";

/**
 * One Offer per paid plan, from the same catalog the pricing cards use: the monthly price
 * (unitText MON), the quota in the description and the overage as a second UnitPriceSpecification.
 */
export function paidPlanOffers(locale: "pt" | "en") {
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  return PLANS.filter((plan) => plan.basePriceCents > 0).map((plan) => {
    const price = (plan.basePriceCents / 100).toFixed(2);
    return {
      "@type": "Offer",
      name: plan.slug.charAt(0).toUpperCase() + plan.slug.slice(1),
      description:
        locale === "pt" ? `${nf.format(plan.credits)} notas por mês incluídas` : `${nf.format(plan.credits)} invoices a month included`,
      price,
      priceCurrency: "BRL",
      url: pageUrl(locale),
      priceSpecification: [
        {
          "@type": "UnitPriceSpecification",
          price,
          priceCurrency: "BRL",
          unitText: "MON",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
        },
        {
          "@type": "UnitPriceSpecification",
          price: (plan.perCreditCents / 100).toFixed(2),
          priceCurrency: "BRL",
          unitText: locale === "pt" ? "nota excedente" : "extra invoice",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1 },
        },
      ],
    };
  });
}
