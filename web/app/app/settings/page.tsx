"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Toggle } from "@/components/ui/toggle";

const TOGGLE_KEYS = ["blockOutsideHours", "lowBalanceAlert"] as const;

export default function SettingsPage() {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="dash-in dash-in-1 overflow-hidden">
        <h2 className="border-b border-border px-5 py-4 text-[14.5px] font-medium">{t("environment")}</h2>
        <ul className="divide-y divide-border">
          {TOGGLE_KEYS.map((key) => (
            <li key={key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <Toggle
                checked={false}
                onChange={() => {}}
                disabled
                label={t(`toggles.${key}.label`)}
                description={t(`toggles.${key}.desc`)}
              />
              <span className="self-start rounded-full border border-border-strong px-2.5 py-1 font-mono text-[10.5px] text-text-3 sm:self-center">
                {t("comingSoon")}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="dash-in dash-in-2 overflow-hidden">
        <h2 className="border-b border-border px-5 py-4 text-[14.5px] font-medium">{t("billing")}</h2>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-sm text-text-3">{t("paymentsPending")}</p>
          <div>
            <Button variant="secondary" disabled className="max-sm:w-full">
              {t("openStripePortal")}
            </Button>
          </div>
        </div>
      </Card>

      <section
        aria-labelledby="danger-zone"
        className="dash-in dash-in-3 flex flex-col gap-4 rounded-[12px] border border-danger-border bg-danger-surface p-5 sm:flex-row sm:items-center"
      >
        <div className="flex flex-1 flex-col gap-1">
          <h2 id="danger-zone" className="text-[14px] font-medium text-danger">
            {t("deleteWorkspace")}
          </h2>
          <p className="text-[13px] text-text-3">{t("deleteWorkspaceDesc")}</p>
        </div>
        <Button variant="danger" disabled className="max-sm:w-full">
          {tc("delete")}
        </Button>
      </section>
    </div>
  );
}
