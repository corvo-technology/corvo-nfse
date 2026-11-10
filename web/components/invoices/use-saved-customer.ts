"use client";

import { useEffect, useRef, useState } from "react";
import { customers as customersApi } from "@/lib/api";
import { isValidCnpj, isValidCpf } from "@/lib/masks";
import type { SavedCustomer } from "@/lib/types";

const TYPING_PAUSE_MS = 300;

const isCompleteDocument = (digits: string) =>
  digits.length === 11 ? isValidCpf(digits) : digits.length === 14 && isValidCnpj(digits);

/**
 * The customer saved for a CPF/CNPJ, looked up when the document in the field is complete and valid.
 * `onFound` runs once per answer, so the form can fill the name. A failed lookup stays quiet: the
 * person can always type the name.
 */
export function useSavedCustomer(taxId: string, onFound: (customer: SavedCustomer) => void): SavedCustomer | null {
  const [found, setFound] = useState<{ taxId: string; customer: SavedCustomer } | null>(null);
  const notify = useRef(onFound);
  useEffect(() => { notify.current = onFound; });

  useEffect(() => {
    if (!isCompleteDocument(taxId)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      customersApi.find(taxId, controller.signal).then((customer) => {
        if (controller.signal.aborted || !customer) return;
        setFound({ taxId, customer });
        notify.current(customer);
      }).catch(() => undefined);
    }, TYPING_PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [taxId]);

  // An answer only counts while its document is still the one in the field.
  return found?.taxId === taxId ? found.customer : null;
}
