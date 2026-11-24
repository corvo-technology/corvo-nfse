"use client";

import { useEffect, useRef, useState } from "react";
import { customers as customersApi } from "@/lib/api";
import { isValidCnpj, isValidCpf } from "@/lib/masks";
import type { CustomerRegistryInfo, SavedCustomer } from "@/lib/types";

const TYPING_PAUSE_MS = 300;

const isCompleteDocument = (digits: string) =>
  digits.length === 11 ? isValidCpf(digits) : digits.length === 14 && isValidCnpj(digits);

/**
 * The customer saved for a CPF/CNPJ, looked up when the document in the field is complete and valid.
 * `onFound` runs once per answer, so the form can fill the name. A failed lookup stays quiet: the
 * person can always type the name.
 *
 * When nothing was saved for a CNPJ, `onRegistry` (if given) gets what the public registry says
 * (name, city, UF). A CPF is never looked up: there is no public source for it. A slow or failed
 * registry answers nothing and the form is filled by hand.
 */
export function useSavedCustomer(
  taxId: string,
  onFound: (customer: SavedCustomer) => void,
  onRegistry?: (info: CustomerRegistryInfo) => void,
): SavedCustomer | null {
  const [found, setFound] = useState<{ taxId: string; customer: SavedCustomer } | null>(null);
  const notify = useRef(onFound);
  const notifyRegistry = useRef(onRegistry);
  useEffect(() => { notify.current = onFound; notifyRegistry.current = onRegistry; });

  useEffect(() => {
    if (!isCompleteDocument(taxId)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      customersApi.find(taxId, controller.signal).then(async (customer) => {
        if (controller.signal.aborted) return;
        if (customer) {
          setFound({ taxId, customer });
          notify.current(customer);
          return;
        }
        if (taxId.length !== 14 || !notifyRegistry.current) return;
        const info = await customersApi.registry(taxId, controller.signal);
        if (!controller.signal.aborted && info) notifyRegistry.current?.(info);
      }).catch(() => undefined);
    }, TYPING_PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [taxId]);

  // An answer only counts while its document is still the one in the field.
  return found?.taxId === taxId ? found.customer : null;
}
