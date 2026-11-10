// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { MunicipalityAgreementNotice } from "@/components/companies/municipality-agreement-notice";
import { findMunicipality, loadMunicipalities } from "@/lib/nfse-municipalities";
import messages from "@/messages/pt.json";

const show = (municipalityCode: string, taxRegime: string) =>
  render(<NextIntlClientProvider locale="pt" messages={messages}><MunicipalityAgreementNotice municipalityCode={municipalityCode} taxRegime={taxRegime} /></NextIntlClientProvider>);
/** Lets the lazy list load, so "nothing shown" is a real answer and not a pending one. */
const settled = async () => { await loadMunicipalities(); await new Promise((resolve) => setTimeout(resolve, 0)); };
afterEach(cleanup);

describe("findMunicipality", () => {
  it("finds a municipality by its IBGE code and refuses anything that is not 7 digits", async () => {
    const { rows } = await loadMunicipalities();
    expect(findMunicipality(rows, "3550308")?.[1]).toBe("São Paulo");
    expect(findMunicipality(rows, "9999999")).toBeUndefined();
    expect(findMunicipality(rows, "355030")).toBeUndefined();
  });
});

describe("MunicipalityAgreementNotice", () => {
  it("warns a Simples Nacional company whose municipality has no active agreement, pointing to the list", async () => {
    // Uses a municipality that is "agreement not active" on the bundled official list.
    const { rows } = await loadMunicipalities();
    const [code, name, uf] = rows.find((row) => row[3] === 0)!;
    show(String(code), "Simples Nacional");
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain(`${name} (${uf})`);
    expect(notice.textContent).toContain("ainda não está ativo");
    expect(screen.getByRole("link", { name: messages.MunicipalityNotice.link }).getAttribute("href")).toBe("/pt/docs/municipalities");
  });

  it("stays silent for a MEI in the same municipality: the rule exempts the MEI", async () => {
    const { rows } = await loadMunicipalities();
    show(String(rows.find((row) => row[3] === 0)![0]), "MEI");
    await settled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays silent for municipalities on the national issuer or sharing with the national environment", async () => {
    const { rows } = await loadMunicipalities();
    show("3550308", "Simples Nacional");
    await settled();
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    show(String(rows.find((row) => row[3] === 1)![0]), "Simples Nacional");
    await settled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("flags a code that is not on the official list, for any regime", async () => {
    show("9999999", "MEI");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("9999999"));
  });

  it("shows nothing while the code is incomplete", async () => {
    show("35503", "Simples Nacional");
    await settled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
