"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { invoices } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { readFlag, writeFlag } from "@/lib/onboarding-flags";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const HIGHLIGHT_ENV_EVENT = "onboarding-highlight-env";

/**
 * Explains the account's first test note. "First" means the only test note of the account: the list comes
 * newest first, so asking for two is the cheapest way to know there is exactly one and that it is this one.
 */
export function FirstNoteBanner({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("Onboarding.note");
  const { tenantId, fiscalEnvironment } = useAuth();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!tenantId || fiscalEnvironment !== "test" || readFlag(tenantId, "noteBannerDismissed")) return;
    let cancelled = false;
    invoices.list({ limit: 2 }).then((page) => {
      if (cancelled || page.items.length !== 1 || page.items[0].id !== invoiceId) return;
      setShown(true);
      window.dispatchEvent(new CustomEvent(HIGHLIGHT_ENV_EVENT));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [tenantId, fiscalEnvironment, invoiceId]);

  if (!shown) return null;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-base font-medium">{t("title")}</h2>
      <ul className="flex flex-col gap-2 text-sm text-text-3">
        <li>{t("status")}</li>
        <li>{t("files")}</li>
        <li>{t("env")}</li>
      </ul>
      <div>
        <Button variant="ghost" onClick={() => { if (tenantId) writeFlag(tenantId, "noteBannerDismissed"); setShown(false); }}>{t("dismiss")}</Button>
      </div>
    </Card>
  );
}
