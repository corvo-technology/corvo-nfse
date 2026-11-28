import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCsrfToken } from "@/lib/api";
import { cancelNfe, correctNfe, createInutilization, createNfe, discardNfe, getNfe, getNfeSettings, isNfePending, listInutilizations, listNfe, listNfeEvents, listNumberGaps, nfeActions, nfeDownloadUrl, resubmitNfe, syncNfe, updateNfeSettings, validateNfe, type NfeCreateInput } from "@/lib/nfe";

const fetchMock = vi.fn<typeof fetch>();
const input = { companyId: "c1", recipient: { taxId: "1", name: "A", indIeDest: 9, address: { street: "s", number: "1", district: "d", zip: "z", cityCode: "1", city: "c", state: "SP" } }, items: [], payments: [] } as NfeCreateInput;
const last = () => { const [url, init] = fetchMock.mock.calls.at(-1)!; return { url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) }; };

beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: { id: "n1" }, pagination: { hasMore: false, nextCursor: null } }), { status: 200 })); vi.stubGlobal("fetch", fetchMock); setCsrfToken("csrf"); });
afterEach(() => { vi.unstubAllGlobals(); setCsrfToken(null); });

it("every NF-e call goes to the unified /invoices routes, with the type where the API needs it", async () => {
  await validateNfe(input);
  expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices/validate", method: "POST", body: { type: "nfe", companyId: "c1" } });
  await listNfe({ limit: 50, status: "rejected", companyId: "c1" });
  expect(last().url).toBe("/api/proxy/v1/invoices?type=nfe&limit=50&status=rejected&companyId=c1");
  await getNfe("n 1");
  expect(last().url).toBe("/api/proxy/v1/invoices/n%201");
  await listNfeEvents("n1");
  expect(last().url).toBe("/api/proxy/v1/invoices/n1/events");
  await listInutilizations({ limit: 5 });
  expect(last().url).toBe("/api/proxy/v1/invoices/inutilizations?type=nfe&limit=5");
  await listNumberGaps("c1");
  expect(last().url).toBe("/api/proxy/v1/invoices/number-gaps?type=nfe&companyId=c1");
});

it("the actions on a note go by its id and use the method of each route", async () => {
  await syncNfe("n1"); expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices/n1/sync", method: "POST" });
  await discardNfe("n1"); expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices/n1/discard", method: "POST" });
  await cancelNfe("n1", "Cliente desistiu da compra"); expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices/n1/cancel", body: { justification: "Cliente desistiu da compra" } });
  await correctNfe("n1", "Corrigir o endereço"); expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices/n1/corrections", body: { correction: "Corrigir o endereço" } });
  await nfeDownloadUrl("n1", "xml"); expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices/n1/download-url", body: { format: "xml" } });
});

it("issuing, resending and inutilizing carry the Idempotency-Key", async () => {
  await createNfe(input, "key-1");
  expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices", method: "POST", body: { type: "nfe" } });
  expect(last().headers.get("idempotency-key")).toBe("key-1");
  await resubmitNfe("n1", input, "key-2");
  expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices/n1", method: "PUT" });
  expect(last().headers.get("idempotency-key")).toBe("key-2");
  await createInutilization({ companyId: "c1", series: 1, start: 3, end: 4, justification: "Numeração pulada por falha" }, "key-3");
  expect(last()).toMatchObject({ url: "/api/proxy/v1/invoices/inutilizations", body: { type: "nfe", start: 3, end: 4 } });
  expect(last().headers.get("idempotency-key")).toBe("key-3");
});

it("the company settings live under /companies/{id}/nfe-settings", async () => {
  await getNfeSettings("c1");
  expect(last()).toMatchObject({ url: "/api/proxy/v1/companies/c1/nfe-settings" });
  await updateNfeSettings("c1", { stateRegistration: "110042490114", crt: 1 });
  expect(last()).toMatchObject({ url: "/api/proxy/v1/companies/c1/nfe-settings", method: "PUT", body: { stateRegistration: "110042490114", crt: 1 } });
});

it("the buttons follow the state and the permission", () => {
  const all = () => true;
  const only = (...allowed: string[]) => (permission: string) => allowed.includes(permission);
  expect(nfeActions({ status: "authorized", documentsReady: true }, all)).toMatchObject({ cancel: true, correct: true, sync: false, resubmit: false, discard: false, download: true });
  expect(nfeActions({ status: "rejected", documentsReady: false }, all)).toMatchObject({ cancel: false, correct: false, resubmit: true, discard: true, download: false });
  expect(nfeActions({ status: "manual_review", documentsReady: false }, all).sync).toBe(true);
  // Copy: any note, for who may issue; e-mail again: only authorized with the files ready.
  expect(nfeActions({ status: "authorized", documentsReady: true }, all)).toMatchObject({ copy: true, resendEmail: true });
  expect(nfeActions({ status: "authorized", documentsReady: false }, all).resendEmail).toBe(false);
  expect(nfeActions({ status: "cancelled", documentsReady: true }, all)).toMatchObject({ copy: true, resendEmail: false });
  expect(nfeActions({ status: "authorized", documentsReady: true }, () => false)).toMatchObject({ copy: false, resendEmail: false });
  expect(nfeActions({ status: "reconciliation_required", documentsReady: false }, all).sync).toBe(true);
  expect(nfeActions({ status: "authorized", documentsReady: true }, only("nfe.documents.view", "nfe.documents.issue"))).toMatchObject({ cancel: false, correct: false });
  expect(nfeActions({ status: "rejected", documentsReady: false }, only("nfe.documents.manage"))).toMatchObject({ discard: true, resubmit: false });
  expect(isNfePending("processing")).toBe(true);
  expect(isNfePending("authorized")).toBe(false);
});
