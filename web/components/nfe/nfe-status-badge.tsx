"use client";

import { useTranslations } from "next-intl";
import type { NfeStatus } from "@/lib/nfe";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<NfeStatus, "accent" | "warn" | "danger" | "info" | "gray"> = {
  queued: "gray",
  processing: "info",
  retry_pending: "warn",
  reconciliation_required: "warn",
  manual_review: "warn",
  authorized: "accent",
  cancelling: "warn",
  cancelled: "gray",
  rejected: "danger",
  denied: "danger",
  discarded: "gray",
};

/** The state of an NF-e in plain words, colored by how much attention it needs. */
export function NfeStatusBadge({ status }: { status: NfeStatus }) {
  const t = useTranslations("Nfe.status");
  return <Badge variant={VARIANT[status] ?? "gray"}>{t.has(status) ? t(status) : status}</Badge>;
}
