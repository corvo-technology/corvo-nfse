"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ieExample } from "@/lib/nfe-form";

export interface NfeFieldValues { stateRegistration: string; series: string; nfceSeries: string; natOp: string; csosn: "102" | "400" }

/** What a new company starts with: the same defaults the API uses when nothing is sent. */
export const NFE_FIELD_DEFAULTS: NfeFieldValues = { stateRegistration: "", series: "1", nfceSeries: "1", natOp: "Venda de mercadoria", csosn: "102" };

/** Series are small whole numbers: digits only, no spinner arrows of a number input. */
const digits = (value: string) => value.replace(/\D/g, "").slice(0, 3);

interface NfeFieldsProps {
  values: NfeFieldValues;
  onChange: (patch: Partial<NfeFieldValues>) => void;
  /** State (UF) of the company, to show an IE example. */
  uf?: string;
  disabled?: boolean;
  /** NFC-e is released: the series of the consumer sales is asked too. */
  nfce?: boolean;
  /** The CSOSN only exists for Simples Nacional and MEI. */
  showCsosn?: boolean;
  ieError?: string;
  /** The IE is asked but not required (a company that is still being created). */
  ieOptionalLabel?: string;
  ieHint?: string;
  /** Shown between the IE and the series (the tax regime of the company). */
  afterIe?: ReactNode;
}

/** The fields of the NF-e/NFC-e data, shared by the company page and the creation flow. Render them inside a two-column grid. */
export function NfeFields({ values, onChange, uf = "", disabled, nfce = false, showCsosn = true, ieError, ieOptionalLabel, ieHint, afterIe }: NfeFieldsProps) {
  const t = useTranslations("Nfe.settings");
  return (
    <>
      <Field label={t("stateRegistration")} hint={ieHint ?? t("stateRegistrationHint")} error={ieError} required={!ieOptionalLabel} optionalLabel={ieOptionalLabel}>
        {(control) => <Input {...control} value={values.stateRegistration} disabled={disabled} inputMode="numeric" autoComplete="off" placeholder={t("stateRegistrationPlaceholder", { example: ieExample(uf) })} onChange={(event) => onChange({ stateRegistration: event.target.value })} />}
      </Field>
      {afterIe}
      <Field label={t("series")} hint={t("seriesHint")}>
        {(control) => <Input {...control} inputMode="numeric" maxLength={3} autoComplete="off" placeholder="1" value={values.series} disabled={disabled} onChange={(event) => onChange({ series: digits(event.target.value) })} />}
      </Field>
      {nfce && (
        <Field label={t("nfceSeries")} hint={t("nfceSeriesHint")}>
          {(control) => <Input {...control} inputMode="numeric" maxLength={3} autoComplete="off" placeholder="1" value={values.nfceSeries} disabled={disabled} onChange={(event) => onChange({ nfceSeries: digits(event.target.value) })} />}
        </Field>
      )}
      <Field label={t("natOp")} hint={t("natOpHint")}>
        {(control) => <Input {...control} maxLength={60} placeholder={t("natOpPlaceholder")} value={values.natOp} disabled={disabled} onChange={(event) => onChange({ natOp: event.target.value })} />}
      </Field>
      {showCsosn && (
        <Field label={t("csosn")} hint={t("csosnHint")}>
          {(control) => (
            <Select {...control} value={values.csosn} disabled={disabled} onChange={(event) => onChange({ csosn: event.target.value as "102" | "400" })}>
              <option value="102">{t("csosn102")}</option>
              <option value="400">{t("csosn400")}</option>
            </Select>
          )}
        </Field>
      )}
    </>
  );
}
