"use client";
import { useEffect, useState } from "react";
import { PackageOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { collectAll, companies, invoicePackages } from "@/lib/api";
import type { Company } from "@/lib/types";
import { saveBlob } from "@/lib/download";
import { useApiErrorText } from "@/lib/use-api-error";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";

const currentMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; };

/** "Download the month package": a ZIP with the XML and PDF of the month's notes and a summary sheet for the accountant. */
export function InvoicePackageButton() {
  const t = useTranslations("InvoicePackage");
  const apiError = useApiErrorText();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    collectAll((cursor) => companies.list({ cursor, limit: 100 }, abort.signal))
      .then((items) => { if (!abort.signal.aborted) { setList(items); setCompanyId((current) => current || items[0]?.id || ""); } })
      .catch(() => undefined);
    return () => abort.abort();
  }, [open]);

  async function download() {
    const company = list.find((item) => item.id === companyId);
    if (!company || !/^\d{4}-\d{2}$/.test(month)) return;
    setBusy(true); setMessage(null);
    try {
      const summary = await invoicePackages.summary(company.id, month);
      if (summary.count === 0) return setMessage(t("empty"));
      if (summary.count > summary.limit) return setMessage(t("tooLarge", { count: summary.count, limit: summary.limit }));
      saveBlob(await invoicePackages.download(company.id, month), `nfse-${month}-${company.taxId}.zip`);
      setOpen(false);
    } catch (cause) { setMessage(apiError(cause, t("failed"))); }
    finally { setBusy(false); }
  }

  return <>
    <Button variant="secondary" onClick={() => { setMessage(null); setOpen(true); }}><PackageOpen size={15} aria-hidden />{t("button")}</Button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title={t("title")}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void download(); }}>
        <p className="text-sm text-text-3">{t("hint")}</p>
        {list.length > 1 && <Field label={t("company")}>{(control) => <Select {...control} value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{list.map((item) => <option key={item.id} value={item.id}>{item.tradeName || item.legalName}</option>)}</Select>}</Field>}
        <Field label={t("month")}>{(control) => <Input {...control} type="month" required value={month} onChange={(event) => setMonth(event.target.value)} />}</Field>
        {message && <p role="alert" className="text-sm text-danger">{message}</p>}
        <Button type="submit" loading={busy} disabled={!companyId}>{t("download")}</Button>
      </form>
    </Modal>
  </>;
}
