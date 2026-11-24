// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollToHash } from "@/lib/use-scroll-to-hash";

function Target({ ready = true }: { ready?: boolean }) {
  useScrollToHash("certificado", ready);
  return <div id="certificado" data-testid="target" />;
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.location.hash = ""; });

describe("useScrollToHash", () => {
  it("scrolls to the element and highlights it for about 2s when the hash matches", () => {
    window.location.hash = "#certificado";
    render(<Target />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(screen.getByTestId("target").className).toContain("ring-2");
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.getByTestId("target").className).not.toContain("ring-2");
  });

  it("does nothing for another hash or while not ready", () => {
    window.location.hash = "#numeracao";
    const view = render(<Target />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    view.unmount();
    window.location.hash = "#certificado";
    render(<Target ready={false} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByTestId("target").className).not.toContain("ring-2");
  });
});
