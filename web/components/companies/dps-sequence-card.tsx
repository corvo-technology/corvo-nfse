"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { companies, type DpsNumberingCheck, type DpsSequence } from "@/lib/api";
import { useScrollToHash } from "@/lib/use-scroll-to-hash";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

/** Where the DPS numbering of a company stands, and the way to continue it from notes issued elsewhere. */
export function DpsSequenceCard({ companyId, canManage, environment }: { companyId: string; canManage: boolean; environment?: "test" | "live" }) {
  const t = useTranslations("CompanyDetail.dps");
  const errorText = useApiErrorText();
  const [sequence, setSequence] = useState<DpsSequence | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<DpsNumberingCheck | null>(null);

  useScrollToHash("numeracao");

  useEffect(() => {
    const abort = new AbortController();
    companies.dpsSequence(companyId, abort.signal).then(setSequence).catch(() => undefined);
    return () => abort.abort();
  }, [companyId]);

  async function save() {
    setMessage(null);
    if (!/^[1-9]\d{0,14}$/.test(value.trim())) return setError(t("invalid"));
    setError(null);
    setSaving(true);
    try {
      // The field is the number of the NEXT note; the API stores the last one used.
      const next = await companies.setDpsSequence(companyId, Number(value) - 1);
      setSequence(next);
      setValue("");
      setMessage(t("saved", { number: next.lastNumber + 1 }));
    } catch (e) {
      setError(errorText(e, t("invalid")));
    } finally {
      setSaving(false);
    }
  }

  async function runCheck() {
    setMessage(null);
    setError(null);
    setChecking(true);
    try {
      setCheck(await companies.checkDpsNumbering(companyId));
    } catch (e) {
      setError(errorText(e, t("invalid")));
    } finally {
      setChecking(false);
    }
  }

  async function confirmCheck(lastNumber?: number) {
    setError(null);
    setSaving(true);
    try {
      const next = await companies.confirmDpsNumbering(companyId, lastNumber);
      setSequence(next);
      setCheck(null);
      setMessage(t("confirmed", { number: next.lastNumber + 1 }));
    } catch (e) {
      setError(errorText(e, t("invalid")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card id="numeracao" className={`flex scroll-mt-24 flex-col gap-4 p-5`}>
      <div>
        <h2 className="text-base font-medium">{t("title")}</h2>
        <p className="mt-1 text-sm text-text-3">{t("hint")}</p>
        {environment === "test" && <p className="mt-2 text-sm text-text-3">{t("testNote")}</p>}
      </div>
      {sequence && (
        <p className="text-sm">
          {sequence.lastNumber > 0 ? t("current", { next: sequence.lastNumber + 1, series: sequence.series }) : t("none", { next: 1, series: sequence.series })}
        </p>
      )}
      {canManage && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label={t("label")} hint={t("help")} error={error ?? undefined} className="w-full max-w-xs">
            {(c) => <Input {...c} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
          <Button type="submit" loading={saving}>{t("save")}</Button>
        </form>
      )}
      {canManage && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" loading={checking} onClick={() => void runCheck()}>{checking ? t("checking") : t("check")}</Button>
            <span className="text-sm text-text-3">{t("checkHint")}</span>
          </div>
          {check && (
            <div role="status" className="flex flex-col gap-2 text-sm">
              <p>
                {check.usedNumbers.length === 0
                  ? t("checkFree", { number: check.nextNumber })
                  : t("checkUsed", { count: check.usedNumbers.length, first: check.usedNumbers[0], last: check.usedNumbers[check.usedNumbers.length - 1], next: check.suggestedNext })}
                {check.moreMayBeUsed && ` ${t("checkMore")}`}
              </p>
              <div>
                {check.usedNumbers.length === 0
                  ? <Button type="button" loading={saving} onClick={() => void confirmCheck()}>{t("confirmFree")}</Button>
                  : <Button type="button" loading={saving} onClick={() => void confirmCheck(check.suggestedNext - 1)}>{t("useSuggested", { next: check.suggestedNext })}</Button>}
              </div>
            </div>
          )}
        </div>
      )}
      {message && <p role="status" className="text-sm text-text-3">{message}</p>}
    </Card>
  );
}
