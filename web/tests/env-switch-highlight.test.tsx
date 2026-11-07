// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { EnvSwitch } from "@/components/dashboard/env-switch";
import messages from "@/messages/en.json";

afterEach(cleanup);
const group = (highlight?: boolean) => {
  render(<NextIntlClientProvider locale="en" messages={messages}><EnvSwitch value="test" onChange={() => undefined} highlight={highlight} /></NextIntlClientProvider>);
  return screen.getByRole("radiogroup");
};

describe("EnvSwitch highlight", () => {
  it("is marked only when asked to draw attention", () => {
    expect(group(true).getAttribute("data-highlight")).toBe("true");
    cleanup();
    expect(group().getAttribute("data-highlight")).toBeNull();
  });
});
