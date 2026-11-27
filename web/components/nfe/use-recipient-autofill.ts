"use client";

import { useEffect, useRef, useState } from "react";
import { cnpj as cnpjApi, customers as customersApi } from "@/lib/api";
import { cleanTaxId, isValidCnpj, isValidCpf, maskZip } from "@/lib/masks";
import { lookupCep, type CepResult } from "@/lib/viacep";
import type { NfeFormState } from "@/lib/nfe-form";

type Recipient = NfeFormState["recipient"];
const TYPING_PAUSE_MS = 300;

/** What the helpers filled, so the form can tell the person to check it. */
export type AutofillSource = "customer" | "cnpj" | "cep";

const isComplete = (id: string) => (id.length === 11 ? isValidCpf(id) : id.length === 14 && isValidCnpj(id));
const blank = (value: string) => value.trim() === "";

/**
 * Fills the recipient from what the NFS-e flow already knows: the saved customers (name and e-mail),
 * the public CNPJ registry (name and address) and, for the address, the CEP. The document lookups fill
 * only empty fields, so nothing the person typed is lost; a new CEP replaces the street, district,
 * city, state and IBGE code, because the person is changing the address. A lookup that fails stays
 * quiet: everything can be typed.
 */
export function useRecipientAutofill(recipient: Recipient, patch: (value: Partial<Recipient>) => void): AutofillSource | null {
  const [source, setSource] = useState<AutofillSource | null>(null);
  const current = useRef(recipient);
  const apply = useRef(patch);
  useEffect(() => { current.current = recipient; apply.current = patch; });

  const taxId = cleanTaxId(recipient.taxId);
  useEffect(() => {
    if (!isComplete(taxId)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const fill: Partial<Recipient> = {};
        let from: AutofillSource | null = null;
        const saved = await customersApi.find(taxId, controller.signal).catch(() => null);
        if (controller.signal.aborted) return;
        if (saved) {
          if (blank(current.current.name)) fill.name = saved.name;
          if (blank(current.current.email) && saved.email) fill.email = saved.email;
          from = "customer";
        }
        if (taxId.length === 14) {
          const profile = await cnpjApi.lookup(taxId, controller.signal).catch(() => null);
          if (controller.signal.aborted) return;
          if (profile) {
            const now = current.current;
            if (blank(now.name) && !fill.name) fill.name = profile.legalName;
            const a = profile.address;
            const address: Partial<Recipient> = { street: a.street, number: a.number, complement: a.complement, district: a.district, zip: maskZip(a.zip), city: a.city, state: a.state, cityCode: profile.municipalityCode ?? "" };
            for (const key of Object.keys(address) as (keyof Recipient)[]) {
              const value = address[key];
              if (typeof value === "string" && value !== "" && blank(now[key] as string)) (fill as Record<string, string>)[key] = value;
            }
            from = from ?? "cnpj";
          }
        }
        if (Object.keys(fill).length > 0) { apply.current(fill); setSource(from); }
      })();
    }, TYPING_PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [taxId]);

  const zip = recipient.zip.replace(/\D/g, "");
  // The CEP already on the form (a note being fixed) is not looked up again: it would replace what was saved.
  const lastZip = useRef(zip);
  useEffect(() => {
    if (zip.length !== 8 || zip === lastZip.current) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      lookupCep(zip, controller.signal).then((found: CepResult | null) => {
        if (controller.signal.aborted || !found) return;
        lastZip.current = zip;
        apply.current({ street: found.street || current.current.street, district: found.district || current.current.district, city: found.city, state: found.state, cityCode: found.ibge });
        setSource("cep");
      }).catch(() => undefined);
    }, TYPING_PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [zip]);

  return source;
}
