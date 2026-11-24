/**
 * The new-invoice form draft, kept in sessionStorage (this tab only) so leaving the page and
 * coming back loses nothing. One draft per company; the last company used is remembered.
 */
const PREFIX = "corvo:invoice-draft:";
const LAST = `${PREFIX}last`;

export interface InvoiceDraft { companyId: string; form: Record<string, string>; sendEmail: boolean }

export function writeInvoiceDraft(companyId: string, form: object, sendEmail: boolean) {
  try {
    sessionStorage.setItem(`${PREFIX}${companyId}`, JSON.stringify({ form, sendEmail }));
    sessionStorage.setItem(LAST, companyId);
  } catch { /* storage blocked or full: the form still works, just without a draft */ }
}

/** The draft of the last company used, if that company is still in `companyIds`. */
export function readInvoiceDraft(companyIds: string[]): InvoiceDraft | null {
  try {
    const companyId = sessionStorage.getItem(LAST);
    if (!companyId || !companyIds.includes(companyId)) return null;
    const raw = sessionStorage.getItem(`${PREFIX}${companyId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { form?: Record<string, string>; sendEmail?: boolean };
    if (!parsed.form || typeof parsed.form !== "object") return null;
    return { companyId, form: parsed.form, sendEmail: parsed.sendEmail !== false };
  } catch { return null; }
}

/** After the note is issued: drops every draft. */
export function clearInvoiceDraft() {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
  } catch { /* nothing to clear */ }
}
