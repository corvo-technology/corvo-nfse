// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DpsSequenceCard } from "@/components/companies/dps-sequence-card";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  companies: { dpsSequence: mocks.get, setDpsSequence: mocks.set },
}));

const renderCard = (canManage = true, environment?: "test" | "live") => render(<NextIntlClientProvider locale="en" messages={messages}><DpsSequenceCard companyId="c1" canManage={canManage} environment={environment} /></NextIntlClientProvider>);
const typeAndSave = (value: string) => {
  fireEvent.change(screen.getByLabelText(/Next note number \(DPS\)/), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save number" }));
};

beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ series: "1", lastNumber: 7 }); });
afterEach(cleanup);

describe("DpsSequenceCard", () => {
  it("explains the random high start only for a test company", async () => {
    const test = renderCard(true, "test");
    await screen.findByText(/starts at a high random number/);
    test.unmount();
    renderCard(true, "live");
    await screen.findByText(/Next note in Corvo/);
    expect(screen.queryByText(/starts at a high random number/)).toBeNull();
  });

  it("shows where the numbering stands", async () => {
    renderCard();
    await screen.findByText("Next note in Corvo: no. 8 (series 1)");
  });

  it("says so when nothing was issued yet", async () => {
    mocks.get.mockResolvedValue({ series: "1", lastNumber: 0 });
    renderCard();
    await screen.findByText("We have not issued any note here yet. The next one will be no. 1 (series 1).");
  });

  it("saves the next number: the API gets the last one used (next minus one)", async () => {
    mocks.set.mockResolvedValue({ series: "1", lastNumber: 120 });
    renderCard();
    await screen.findByText(/no\. 8/);
    typeAndSave("121");
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith("c1", 120));
    await screen.findByText("Done. The next note will be no. 121.");
  });

  it("shows the translated text when the number is lower than one already used", async () => {
    mocks.set.mockRejectedValue(new ApiError(422, "lower", "DPS_NUMBER_BELOW_CURRENT"));
    renderCard();
    await screen.findByText(/no\. 8/);
    typeAndSave("3");
    await screen.findByText(messages.ApiErrors.dps_number_below_current);
  });

  it("explains the field in plain words for people coming from the government portal", async () => {
    renderCard();
    await screen.findByText(/If you already issued notes on the government portal/);
  });

  it("rejects a value that is not a whole number without calling the API", async () => {
    renderCard();
    await screen.findByText(/no\. 8/);
    typeAndSave("0");
    await screen.findByText("Enter a whole number, 1 or more.");
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("shows the API's translated error", async () => {
    mocks.set.mockRejectedValue(new ApiError(404, "Resource not found", "ERROR_RESOURCE_NOT_FOUND"));
    renderCard();
    await screen.findByText(/no\. 8/);
    typeAndSave("10");
    await screen.findByText(messages.ApiErrors.resource_not_found);
  });

  it("without the manage permission it only shows the numbering", async () => {
    renderCard(false);
    await screen.findByText(/no\. 8/);
    expect(screen.queryByRole("button", { name: "Save number" })).toBeNull();
  });
});
