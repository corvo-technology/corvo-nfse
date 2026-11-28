import { maskTaxId } from "@/lib/masks";
import type { InvoiceSchedule } from "@/lib/types";

type Body = Record<string, unknown>;
const sub = (body: Body, key: string): Body => (body[key] as Body | undefined) ?? {};

/** Total of what each run issues: `amount` for an NFS-e, the sum of the items for an NF-e (null when it cannot be told). */
export function scheduleTotal(schedule: Pick<InvoiceSchedule, "type" | "invoice">): number | null {
  const body = schedule.invoice as Body;
  if (schedule.type === "nfe") {
    if (!Array.isArray(body.items)) return null;
    const total = (body.items as Array<Record<string, unknown>>).reduce(
      (sum, item) => sum + Number(item.quantity ?? 0) * Number(item.unitPrice ?? 0) - Number(item.discount ?? 0) + Number(item.freight ?? 0) + Number(item.insurance ?? 0) + Number(item.other ?? 0),
      0,
    );
    return Math.round(total * 100) / 100;
  }
  return typeof body.amount === "number" ? body.amount : null;
}

/** Who the note is for: the name, else the CPF/CNPJ, else nothing (an NFS-e may have no tomador). */
export function scheduleRecipient(schedule: Pick<InvoiceSchedule, "type" | "invoice">): string | null {
  const body = schedule.invoice as Body;
  const party = sub(body, schedule.type === "nfe" ? "recipient" : "customer") as { name?: string; taxId?: string };
  return party.name?.trim() || (party.taxId ? maskTaxId(party.taxId) : null);
}
