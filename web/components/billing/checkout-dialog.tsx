"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { Check, Copy, CreditCard, QrCode } from "lucide-react";
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

const POLL_MS = 4000;
const POLL_FOR_MS = 25 * 60_000;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** The QR is drawn here from the Pix code (brCode): the provider's own image is a hosted url, not always inline. */
function usePixQr(brCode: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!brCode) return;
    let cancelled = false;
    QRCode.toDataURL(brCode, { margin: 1, width: 448, errorCorrectionLevel: "M" })
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [brCode]);
  return src;
}

function useCountdown(expiresAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return expiresAt ? new Date(expiresAt).getTime() - now : null;
}

/** Watches the account until the purchase shows up (avulso balance grew, or the account is on the bought plan). */
function usePaymentWatch(active: boolean, target: CheckoutTarget, pollMs: number, onPaid: () => void): boolean {
  const [paid, setPaid] = useState(false);
  const onPaidRef = useRef(onPaid);
  useEffect(() => { onPaidRef.current = onPaid; }, [onPaid]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let baseline: number | null = null;
    const startedAt = Date.now();
    const check = async () => {
      try {
        const account = await billingApi.plan();
        if (stopped) return;
        const balance = account.usage.avulsoBalance ?? 0;
        if (baseline === null) { baseline = balance; return; }
        const done = target.kind === "avulso" ? balance >= baseline + target.units : account.slug === target.slug;
        if (done) { stopped = true; setPaid(true); onPaidRef.current(); }
      } catch { /* keep waiting: a failed poll must not break the screen */ }
    };
    void check();
    const id = setInterval(() => { if (Date.now() - startedAt > POLL_FOR_MS) { clearInterval(id); return; } void check(); }, pollMs);
    return () => { stopped = true; clearInterval(id); };
  }, [active, target, pollMs]);
  return paid;
}

function MethodCard({ value, selected, onSelect, title, description, icon }: { value: PaymentMethod; selected: boolean; onSelect: () => void; title: string; description: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`method-${value}`}
      onClick={onSelect}
      className={cn(
        "group flex flex-col items-start gap-3 rounded-[12px] border p-4 text-left transition-colors",
        selected ? "border-accent bg-accent-surface" : "border-white/12 hover:border-white/25"
      )}
    >
      <span className="flex w-full items-center justify-between">
        <span className={cn("grid h-9 w-9 place-items-center rounded-[10px] border", selected ? "border-accent/50 text-accent" : "border-white/12 text-text-3")}>{icon}</span>
        <span className={cn("grid h-5 w-5 place-items-center rounded-full border", selected ? "border-accent bg-accent text-[#0a0a0a]" : "border-white/25")}>
          {selected && <Check size={12} strokeWidth={3} aria-hidden />}
        </span>
      </span>
      <span>
        <span className="block text-[15px] font-medium text-text">{title}</span>
        <span className="mt-1 block text-[12.5px] leading-snug text-text-3">{description}</span>
      </span>
    </button>
  );
}

/** Woovi wants digits only and the phone with the country code. */
function buildPayer(p: Record<"name" | "taxID" | "email" | "phone", string>) {
  const only = (v: string) => v.replace(/\D/g, "");
  const phone = only(p.phone);
  return {
    name: p.name.trim(),
    taxID: only(p.taxID),
    email: p.email.trim(),
    phone: phone.startsWith("55") && phone.length >= 12 ? phone : `55${phone}`,
  };
}

function Field({ label, value, onChange, className, inputMode, autoComplete }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; className?: string; inputMode?: "numeric" | "tel" | "email"; autoComplete?: string }) {
  return (
    <label className={cn("text-[12.5px] text-text-2", className)}>{label}
      <input value={value} onChange={onChange} inputMode={inputMode} autoComplete={autoComplete} className="mt-1 block w-full rounded-[8px] border border-white/15 bg-transparent px-3 py-2 text-[14px] text-text focus:border-accent focus:outline-none" />
    </label>
  );
}

function CheckoutDialogInner({
  target,
  onClose,
  onError,
  onPaid,
  pollMs = POLL_MS,
  redirect = (url: string) => window.location.assign(url),
}: {
  target: CheckoutTarget | null;
  onClose: () => void;
  onError: (cause: unknown) => void;
  /** Called once when the Pix payment is detected, so the page can refresh plan and balance. */
  onPaid?: () => void;
  pollMs?: number;
  redirect?: (url: string) => void;
}) {
  const t = useTranslations("Billing");
  const tp = useTranslations("Pricing");
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [payer, setPayer] = useState({ name: "", taxID: "", email: "", phone: "" });
  const setField = (key: keyof typeof payer) => (e: React.ChangeEvent<HTMLInputElement>) => setPayer((current) => ({ ...current, [key]: e.target.value }));
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<PixResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per dialog opening: a retry replays the same charge instead of creating another.
  const [key] = useState(() => crypto.randomUUID());
  const qr = usePixQr(pix?.brCode ?? null);
  const remaining = useCountdown(pix?.expiresAt ?? null);
  const paid = usePaymentWatch(pix !== null, target ?? { kind: "avulso", units: 0 }, pollMs, () => onPaid?.());

  if (!target) return null;
  const plan = target.kind === "plan" ? PLANS.find((p) => p.slug === target.slug)! : null;
  const total = plan ? chargeTotalCents(plan, (target as { cycle: BillingCycle }).cycle) : (target as { units: number }).units * AVULSO_UNIT_CENTS;
  const needsPayer = method === "pix" && target.kind === "plan" && target.cycle === "monthly";
  const digits = (value: string) => value.replace(/\D/g, "");
  const payerOk =
    !needsPayer ||
    (payer.name.trim().length > 1 &&
      digits(payer.taxID).length >= 11 &&
      /.+@.+\..+/.test(payer.email.trim()) &&
      digits(payer.phone).length >= 10);
  const expired = remaining !== null && remaining <= 0;

  const summary =
    target.kind === "avulso"
      ? t("checkout.summaryAvulso", { count: target.units })
      : t(target.cycle === "annual" ? "checkout.summaryPlanAnnual" : "checkout.summaryPlanMonthly", { name: tp(`plans.${target.slug}.name`) });

  async function submit() {
    if (!target || busy || !payerOk) return;
    setBusy(true);
    setError(null);
    try {
      const base = target.kind === "avulso" ? ({ kind: "avulso", units: target.units, method } as const)
        : ({ kind: "plan", planSlug: target.slug, cycle: target.cycle, method, customer: needsPayer ? buildPayer(payer) : undefined } as const);
      const result = await billingApi.purchase(base, key);
      if (result.method === "card") redirect(result.url);
      else setPix(result);
    } catch (cause) {
      // A rejected request (invalid payer data, say) stays on the form with its reason, so nothing typed is lost.
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 429) setError(cause.message);
      else onError(cause);
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
      <div className="flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4 rounded-[12px] border border-white/10 px-4 py-3.5">
          <p className="text-[14px] text-text-2">{summary}</p>
          <p className="text-right">
            <span className="block text-[22px] font-semibold leading-none tabular-nums text-text">{formatBRL(total)}</span>
            {target.kind === "plan" && target.cycle === "annual" && <span className="mt-1 block text-[11.5px] text-text-3">{t("checkout.totalAnnualNote")}</span>}
          </p>
        </div>

        {!pix && (
          <>
            <div role="radiogroup" aria-label={t("checkout.method")} className="grid grid-cols-2 gap-3">
              <MethodCard value="pix" selected={method === "pix"} onSelect={() => setMethod("pix")} title={t("checkout.pix")} description={t("checkout.pixDesc")} icon={<QrCode size={18} aria-hidden />} />
              <MethodCard value="card" selected={method === "card"} onSelect={() => setMethod("card")} title={t("checkout.card")} description={t("checkout.cardDesc")} icon={<CreditCard size={18} aria-hidden />} />
            </div>
            {needsPayer && (
              <div className="grid grid-cols-6 gap-3">
                <Field className="col-span-6" label={t("checkout.payerName")} value={payer.name} onChange={setField("name")} autoComplete="name" />
                <Field className="col-span-6 sm:col-span-3" label={t("checkout.payerTaxId")} value={payer.taxID} onChange={setField("taxID")} inputMode="numeric" />
                <Field className="col-span-6 sm:col-span-3" label={t("checkout.payerPhone")} value={payer.phone} onChange={setField("phone")} inputMode="tel" autoComplete="tel" />
                <Field className="col-span-6" label={t("checkout.payerEmail")} value={payer.email} onChange={setField("email")} inputMode="email" autoComplete="email" />
                <p className="col-span-6 text-[12px] text-text-3">{t("checkout.payerHint")}</p>
              </div>
            )}
            {error && <p role="alert" className="rounded-[8px] border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">{error}</p>}
            <Button variant="accent" size="lg" loading={busy} disabled={!payerOk} onClick={() => void submit()}>{t("checkout.pay")}</Button>
          </>
        )}

        {pix && !paid && (
          <div className="flex flex-col items-center gap-4 text-center" data-testid="pix-result">
            {pix.brCode ? (
              <>
                <p className="text-[14px] font-medium text-text">{t("checkout.pixScan")}</p>
                <div className="rounded-[14px] bg-white p-3 shadow-[0_0_0_6px_rgba(255,255,255,0.04)]">
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element -- QR drawn locally from the brCode as a data URL
                    <img src={qr} alt="Pix QR Code" width={224} height={224} className={cn("h-56 w-56", expired && "opacity-20")} />
                  ) : (
                    <div className="h-56 w-56 animate-pulse rounded-[8px] bg-black/5" aria-hidden />
                  )}
                </div>
                <p className="text-[12.5px] text-text-3">{t("checkout.pixOrCopy")}</p>
                <div className="flex w-full items-center gap-2 rounded-[10px] border border-white/12 bg-white/[0.03] p-1.5 pl-3">
                  <input readOnly aria-label={t("checkout.pixCode")} value={pix.brCode} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 truncate bg-transparent font-mono text-[12px] text-text-2 focus:outline-none" />
                  <Button variant="secondary" size="sm" onClick={() => void copy()}>
                    {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                    {copied ? t("checkout.pixCopied") : t("checkout.pixCopy")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[15px] font-medium text-text">{t("checkout.authorizeTitle")}</p>
                <p className="max-w-[360px] text-[13px] leading-relaxed text-text-3">{t("checkout.authorizeBody")}</p>
                <a href={pix.paymentLinkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center rounded-[10px] bg-accent px-5 py-3 text-[15px] font-semibold text-[#0a0a0a]">{t("checkout.authorizeOpen")}</a>
              </>
            )}

            <div className="flex w-full flex-col items-center gap-1.5 border-t border-white/10 pt-4">
              <p role="status" className="flex items-center gap-2 text-[13px] text-text-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                {expired ? t("checkout.expired") : t("checkout.waiting")}
              </p>
              {remaining !== null && !expired && <p className="font-mono text-[12px] tabular-nums text-text-3">{t("checkout.expiresIn", { time: formatRemaining(remaining) })}</p>}
              {pix.brCode && <a href={pix.paymentLinkUrl} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-text-3 underline underline-offset-4 hover:text-text">{t("checkout.pixOpenLink")}</a>}
            </div>
          </div>
        )}

        {pix && paid && (
          <div className="flex flex-col items-center gap-4 py-2 text-center" data-testid="pix-paid">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/15 text-accent"><Check size={28} strokeWidth={2.5} aria-hidden /></span>
            <div>
              <p className="text-[18px] font-semibold text-text">{t("checkout.confirmed")}</p>
              <p className="mt-1 text-[13.5px] text-text-2">
                {target.kind === "avulso" ? t("checkout.confirmedAvulso", { count: target.units }) : t("checkout.confirmedPlan", { name: tp(`plans.${target.slug}.name`) })}
              </p>
            </div>
            <Button variant="accent" size="lg" className="w-full" onClick={onClose}>{t("checkout.done")}</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Remounts per purchase, so Pix result, method and idempotency key never leak between purchases. */
export function CheckoutDialog(props: Parameters<typeof CheckoutDialogInner>[0]) {
  return <CheckoutDialogInner key={JSON.stringify(props.target)} {...props} />;
}

export function purchaseErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status < 500 && cause.status > 0 ? cause.message : fallback;
}
