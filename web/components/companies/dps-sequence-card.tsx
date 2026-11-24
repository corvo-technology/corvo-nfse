"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { companies, type DpsSequence } from "@/lib/api";
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

  useEffect(() => {
    // The page loads its data after render, so the browser cannot jump to #numeracao by itself.
    if (window.location.hash === "#numeracao") document.getElementById("numeracao")?.scrollIntoView({ block: "center" });
  }, []);

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

  return (
    <Card id="numeracao" className="flex scroll-mt-24 flex-col gap-4 p-5">
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
      {message && <p role="status" className="text-sm text-text-3">{message}</p>}
    </Card>
  );
}
