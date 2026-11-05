import { PLANS } from "@/lib/plans-catalog";
import { pageUrl } from "@/lib/seo";

/** One Offer per paid plan, from the same catalog the pricing cards use: monthly price and quota. */
export function paidPlanOffers(locale: "pt" | "en") {
  const nf = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");
  return PLANS.map((plan) => {
    const price = (plan.monthlyCents / 100).toFixed(2);
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
      ],
    };
  });
}
