// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { NfeTimeline } from "@/components/nfe/nfe-timeline";
import type { NfeTimelineEntry } from "@/lib/nfe";
import messages from "@/messages/pt.json";

const entry = (over: Partial<NfeTimelineEntry>): NfeTimelineEntry => ({
  kind: "status", at: "2026-11-27T17:37:30.817Z", status: "queued", from: null, tpEvento: null, sequence: null, eventId: null, text: null, cStat: null, xMotivo: null, ...over,
});
const show = (entries: NfeTimelineEntry[]) => render(<NextIntlClientProvider locale="pt" messages={messages}><NfeTimeline entries={entries} /></NextIntlClientProvider>);
const titles = () => screen.getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);
afterEach(cleanup);

describe("NfeTimeline", () => {
  it("reads the authorized then cancelled history once, with the answer only where the SEFAZ gave one", () => {
    show([
      entry({}),
      entry({ status: "processing", from: "queued" }),
      entry({ status: "authorized", from: "processing", cStat: "100", xMotivo: "Autorizado o uso da NF-e" }),
      entry({ status: "cancelling", from: "authorized", text: "Pedido cancelado pelo cliente antes da entrega" }),
      entry({ status: "cancelled", from: "cancelling", cStat: "135", xMotivo: "Evento registrado e vinculado a NF-e" }),
    ]);
    expect(titles()).toEqual(["Na fila", "Enviando", "Autorizada", "Cancelamento pedido", "Cancelada"]);
    expect(screen.getByText("100 · Autorizado o uso da NF-e")).toBeTruthy();
    expect(screen.getByText("Motivo: Pedido cancelado pelo cliente antes da entrega")).toBeTruthy();
    expect(screen.getByText("135 · Evento registrado e vinculado a NF-e")).toBeTruthy();
    expect(screen.getAllByText(/Autorizado o uso/)).toHaveLength(1);
  });

  it("names a refused cancellation and a correction letter", () => {
    show([
      entry({ status: "authorized", from: "cancelling", cStat: "501", xMotivo: "Prazo superior ao previsto" }),
      entry({ kind: "event", status: "registered", tpEvento: "110110", sequence: 2, eventId: "e", cStat: "135", xMotivo: "Evento registrado e vinculado a NF-e" }),
    ]);
    expect(titles()).toEqual(["Cancelamento recusado", "Carta de correção nº 2"]);
    expect(screen.getByText("Registrada · 135 · Evento registrado e vinculado a NF-e")).toBeTruthy();
    expect(screen.getByText("501 · Prazo superior ao previsto")).toBeTruthy();
  });
});
