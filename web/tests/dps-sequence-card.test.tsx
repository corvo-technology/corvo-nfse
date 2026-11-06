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

const renderCard = (canManage = true) => render(<NextIntlClientProvider locale="en" messages={messages}><DpsSequenceCard companyId="c1" canManage={canManage} /></NextIntlClientProvider>);
const typeAndSave = (value: string) => {
  fireEvent.change(screen.getByLabelText(/Number of the last note issued/), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save numbering" }));
};

beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ series: "1", lastNumber: 7 }); });
afterEach(cleanup);

describe("DpsSequenceCard", () => {
  it("shows where the numbering stands", async () => {
    renderCard();
    await screen.findByText("Last number used in Corvo: no. 7 (series 1)");
  });

  it("says so when nothing was issued yet", async () => {
    mocks.get.mockResolvedValue({ series: "1", lastNumber: 0 });
    renderCard();
    await screen.findByText("We have not issued any note here yet (series 1).");
  });

  it("sends the last number and announces the next one", async () => {
    mocks.set.mockResolvedValue({ series: "1", lastNumber: 120 });
    renderCard();
    await screen.findByText(/no\. 7/);
    typeAndSave("120");
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith("c1", 120));
    await screen.findByText("Numbering updated. The next note will be no. 121.");
  });

  it("tells the user when Corvo is already past the number", async () => {
    mocks.set.mockResolvedValue({ series: "1", lastNumber: 120 });
    renderCard();
    await screen.findByText(/no\. 7/);
    typeAndSave("5");
    await screen.findByText("Corvo is already past that number, so the numbering stays at 120.");
  });

  it("rejects a value that is not a whole number without calling the API", async () => {
    renderCard();
    await screen.findByText(/no\. 7/);
    typeAndSave("12a");
    await screen.findByText("Enter a whole number, zero or more.");
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("shows the API's translated error", async () => {
    mocks.set.mockRejectedValue(new ApiError(404, "Resource not found", "ERROR_RESOURCE_NOT_FOUND"));
    renderCard();
    await screen.findByText(/no\. 7/);
    typeAndSave("10");
    await screen.findByText(messages.ApiErrors.resource_not_found);
  });

  it("without the manage permission it only shows the numbering", async () => {
    renderCard(false);
    await screen.findByText(/no\. 7/);
    expect(screen.queryByRole("button", { name: "Save numbering" })).toBeNull();
  });
});
