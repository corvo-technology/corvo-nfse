import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

/** Shown instead of a page the member's role cannot use. Nothing from the page is loaded. */
export function NoAccess() {
  const t = useTranslations();
  return (
    <div role="alert" className="flex flex-col items-start gap-4 rounded-[12px] border border-border bg-surface p-6">
      <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-active text-text-2">
        <ShieldAlert size={18} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-semibold text-text">{t("Session.noAccessTitle")}</h2>
        <p className="text-[14px] text-text-3">{t("Session.forbidden")}</p>
      </div>
      <Link href="/app" className="btn btn-secondary">{t("Session.backToOverview")}</Link>
    </div>
  );
}
