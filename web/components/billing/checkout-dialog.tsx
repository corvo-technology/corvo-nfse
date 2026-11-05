"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, billing as billingApi, type CheckoutPlan, type PaymentMethod, type PurchaseResult } from "@/lib/api";
import { AVULSO_UNIT_CENTS, PLANS, chargeTotalCents, type BillingCycle } from "@/lib/plans-catalog";
import { formatBRL } from "@/components/pricing/plan-picker";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CheckoutTarget =
  | { kind: "plan"; slug: CheckoutPlan; cycle: BillingCycle }
  | { kind: "avulso"; units: number };

type PixResult = Extract<PurchaseResult, { method: "pix" }>;

/** Pix or card for a plan or for single invoices. Card redirects to Stripe; Pix shows the code here. */
export function CheckoutDialog({
  target,
  onClose,
  onError,
  redirect = (url: string) => window.location.assign(url),
}: {
  target: CheckoutTarget | null;
  onClose: () => void;
  onError: (cause: unknown) => void;
  redirect?: (url: string) => void;
}) {
  const t = useTranslations("Billing");
  const tp = useTranslations("Pricing");
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [name, setName] = useState("");
  const [taxID, setTaxID] = useState("");
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<PixResult | null>(null);
  const [copied, setCopied] = useState(false);
  // One key per dialog opening: a retry replays the same charge instead of creating another.
  const [key] = useState(() => crypto.randomUUID());

  if (!target) return null;
  const plan = target.kind === "plan" ? PLANS.find((p) => p.slug === target.slug)! : null;
  const total = plan ? chargeTotalCents(plan, (target as { cycle: BillingCycle }).cycle) : (target as { units: number }).units * AVULSO_UNIT_CENTS;
  const needsPayer = method === "pix" && target.kind === "plan" && target.cycle === "monthly";
  const payerOk = !needsPayer || (name.trim().length > 1 && taxID.replace(/\D/g, "").length >= 11);

  const summary =
    target.kind === "avulso"
      ? t("checkout.summaryAvulso", { count: target.units })
      : t(target.cycle === "annual" ? "checkout.summaryPlanAnnual" : "checkout.summaryPlanMonthly", { name: tp(`plans.${target.slug}.name`) });

  async function submit() {
    if (!target || busy || !payerOk) return;
    setBusy(true);
    try {
      const base = target.kind === "avulso" ? ({ kind: "avulso", units: target.units, method } as const)
        : ({ kind: "plan", planSlug: target.slug, cycle: target.cycle, method, customer: needsPayer ? { name: name.trim(), taxID: taxID.replace(/\D/g, "") } : undefined } as const);
      const result = await billingApi.purchase(base, key);
      if (result.method === "card") redirect(result.url);
      else setPix(result);
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!pix?.brCode) return;
    await navigator.clipboard.writeText(pix.brCode);
    setCopied(true);
  }

  return (
    <Modal open onClose={onClose} title={t("checkout.title")}>
      <div className="flex flex-col gap-4">
        <div className="rounded-[10px] border border-white/10 p-4">
          <p className="text-[14px] text-text">{summary}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums text-text">
            {formatBRL(total)}
            {target.kind === "plan" && target.cycle === "annual" && <span className="ml-2 text-[12px] font-normal text-text-3">{t("checkout.totalAnnualNote")}</span>}
          </p>
        </div>

        {!pix && (
          <>
            <div role="radiogroup" aria-label={t("checkout.method")} className="grid grid-cols-2 gap-2">
              {(["pix", "card"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={method === value} data-testid={`method-${value}`}
                  onClick={() => setMethod(value)}
                  className={cn("rounded-[10px] border px-4 py-3 text-[14px]", method === value ? "border-accent bg-accent-surface text-text" : "border-white/15 text-text-2")}>
                  {t(`checkout.${value}`)}
                </button>
              ))}
            </div>
            {needsPayer && (
              <div className="flex flex-col gap-3">
                <label className="text-[13px] text-text-2">{t("checkout.payerName")}
                  <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-[8px] border border-white/15 bg-transparent px-3 py-2 text-text" />
                </label>
                <label className="text-[13px] text-text-2">{t("checkout.payerTaxId")}
                  <input value={taxID} inputMode="numeric" onChange={(e) => setTaxID(e.target.value)} className="mt-1 block w-full rounded-[8px] border border-white/15 bg-transparent px-3 py-2 text-text" />
                </label>
                <p className="text-[12px] text-text-3">{t("checkout.payerHint")}</p>
              </div>
            )}
            <Button variant="accent" size="lg" loading={busy} disabled={!payerOk} onClick={() => void submit()}>{t("checkout.pay")}</Button>
          </>
        )}

        {pix && (
          <div className="flex flex-col items-center gap-3 text-center" data-testid="pix-result">
            <p className="text-[13px] text-text-2">{pix.qrCodeImage ? t("checkout.pixScan") : t("checkout.pixAuthorize")}</p>
            {pix.qrCodeImage && /^data:image\/png;base64,/.test(pix.qrCodeImage) && (
              // eslint-disable-next-line @next/next/no-img-element -- QR code is an inline data URL from the payment provider
              <img src={pix.qrCodeImage} alt="Pix QR Code" width={220} height={220} className="rounded-[8px] bg-white p-2" />
            )}
            {pix.brCode && <Button variant="secondary" onClick={() => void copy()}>{copied ? t("checkout.pixCopied") : t("checkout.pixCopy")}</Button>}
            <a href={pix.paymentLinkUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-accent underline">{t("checkout.pixOpenLink")}</a>
            <p className="text-[12px] text-text-3">{t("checkout.pixWaiting")} {pix.expiresAt ? t("checkout.pixExpires") : null}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function purchaseErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status < 500 && cause.status > 0 ? cause.message : fallback;
}
