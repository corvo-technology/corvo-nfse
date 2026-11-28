"use client";

import { useTranslations } from "next-intl";
import type { ScheduleFrequency } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { tomorrowInSaoPaulo } from "@/components/schedules/schedule-form";

export type NfeWhenMode = "now" | "once" | "recurring";
/** When the NF-e is issued: now, once on a date, or repeating. */
export interface NfeWhen { mode: NfeWhenMode; firstDate: string; frequency: ScheduleFrequency; endsOn: string }
export const ISSUE_NOW: NfeWhen = { mode: "now", firstDate: "", frequency: "MONTHLY", endsOn: "" };

const FREQUENCIES: ScheduleFrequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];

interface Props { value: NfeWhen; onChange: (next: NfeWhen) => void; error?: string }

/** "Emitir agora / Agendar / Repetir" of the NF-e form. The items and the price are saved as they are today. */
export function NfeScheduleOptions({ value, onChange, error }: Props) {
  const t = useTranslations("Nfe.form.schedule");
  const ts = useTranslations("Schedules");
  const set = (patch: Partial<NfeWhen>) => onChange({ ...value, ...patch });
  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-medium">{t("title")}</h2>
      <div role="radiogroup" aria-label={t("title")} className="flex flex-wrap gap-x-5 gap-y-2">
        {(["now", "once", "recurring"] as const).map((mode) => (
          <label key={mode} className="flex items-center gap-2 text-sm text-text">
            <input type="radio" name="nfe-when" checked={value.mode === mode} onChange={() => set({ mode })} />
            {t(mode)}
          </label>
        ))}
      </div>
      {value.mode !== "now" && (
        <>
          <p role="note" className="banner banner-warn">{ts("stockWarning")}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {value.mode === "recurring" && (
              <Field label={t("frequency")}>
                {(c) => (
                  <Select {...c} value={value.frequency} onChange={(e) => set({ frequency: e.target.value as ScheduleFrequency })}>
                    {FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{ts(`frequency.${frequency}`)}</option>)}
                  </Select>
                )}
              </Field>
            )}
            <Field label={t("firstDate")} hint={t("firstDateHint")} error={error} required>
              {(c) => <input {...c} type="date" min={tomorrowInSaoPaulo()} value={value.firstDate} onChange={(e) => set({ firstDate: e.target.value })} />}
            </Field>
            {value.mode === "recurring" && (
              <Field label={t("endsOn")} hint={t("endsOnHint")} optionalLabel={ts("form.optional")}>
                {(c) => <input {...c} type="date" min={value.firstDate || tomorrowInSaoPaulo()} value={value.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />}
              </Field>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
