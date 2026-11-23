// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrantCreditsButton } from "@/components/admin/grant-credits-button";
import { DeploymentConfigProvider } from "@/lib/deployment-config-context";
import { CLOUD_DEFAULT_CONFIG } from "@/lib/deployment-config";
import { ApiError } from "@/lib/api";
import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ grant: vi.fn() }));
vi.mock("@/lib/platform-admin", async (original) => ({
  ...(await original<typeof import("@/lib/platform-admin")>()),
  platformAdmin: { grantCredits: mocks.grant },
}));

const t = messages.Admin.grant;
const EMAIL = "ana@example.com";

function setup(billingEnabled = true) {
  const onGranted = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DeploymentConfigProvider config={{ ...CLOUD_DEFAULT_CONFIG, billingEnabled }}>
        <GrantCreditsButton tenantId="t-1" email={EMAIL} onGranted={onGranted} />
      </DeploymentConfigProvider>
    </NextIntlClientProvider>,
  );
  return { onGranted, ...view };
}
const open = () => fireEvent.click(screen.getByRole("button", { name: t.title }));
function fill(amount = "10", reason = "Support gift") {
  fireEvent.change(screen.getByLabelText(new RegExp(t.amount.replace(/[()]/g, "\\$&"))), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText(new RegExp(t.reason)), { target: { value: reason } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: t.submit }));
const confirmText = (amount: string) => t.confirm.replace("{amount}", amount).replace("{email}", EMAIL);

afterEach(() => { cleanup(); mocks.grant.mockReset(); vi.restoreAllMocks(); });

describe("GrantCreditsButton", () => {
  it("não renderiza no self-hosted (billingEnabled false)", () => {
    const { container } = setup(false);
    expect(container.innerHTML).toBe("");
  });

  it("valida quantidade 1–500 e motivo 5–500 antes de enviar", () => {
    setup(); open();
    for (const amount of ["0", "501", "1.5", ""]) {
      fill(amount, "valid reason");
      submit();
      expect(screen.getByText(t.errorAmount)).toBeTruthy();
      expect(screen.queryByText(confirmText(amount))).toBeNull();
    }
    fill("10", "abcd");
    submit();
    expect(screen.getByText(t.errorReason)).toBeTruthy();
    fill("10", "x".repeat(501));
    submit();
    expect(screen.getByText(t.errorReason)).toBeTruthy();
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it("aceita os limites: quantidade 1 e 500, motivo de 5 e de 500 caracteres", () => {
    setup(); open();
    for (const [amount, reason] of [["1", "12345"], ["500", "x".repeat(500)]]) {
      fill(amount, reason);
      submit();
      expect(screen.getByText(confirmText(amount))).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: t.back }));
    }
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it("mostra a confirmação com quantidade e e-mail e só então chama a API", async () => {
    mocks.grant.mockResolvedValue({ tenantId: "t-1", amount: 10, balance: 15, replayed: false });
    const { onGranted } = setup(); open(); fill(); submit();
    expect(screen.getByText(confirmText("10"))).toBeTruthy();
    expect(mocks.grant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    expect(mocks.grant).toHaveBeenCalledWith("t-1", { amount: 10, reason: "Support gift", notifyUser: false }, expect.any(String));
    expect(screen.getByText(t.success.replace("{balance}", "15"))).toBeTruthy();
  });

  it("reenviar após erro de rede usa a mesma Idempotency-Key; reabrir o modal gera outra", async () => {
    let n = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => `key-${++n}` as `${string}-${string}-${string}-${string}-${string}`);
    mocks.grant.mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce({ tenantId: "t-1", amount: 10, balance: 10, replayed: false });
    setup(); open(); fill(); submit();
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(t.errorGeneric));
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(mocks.grant).toHaveBeenCalledTimes(2));
    expect(mocks.grant.mock.calls[0][2]).toBe("key-1");
    expect(mocks.grant.mock.calls[1][2]).toBe("key-1");
    await waitFor(() => expect(screen.getByText(t.success.replace("{balance}", "10"))).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: messages.Common.close }));
    open();
    expect(n).toBe(2);
    fill(); submit();
    mocks.grant.mockResolvedValueOnce({ tenantId: "t-1", amount: 10, balance: 20, replayed: false });
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(mocks.grant).toHaveBeenCalledTimes(3));
    expect(mocks.grant.mock.calls[2][2]).toBe("key-2");
  });

  it("409 IDEMPOTENCY_KEY_REUSED mostra o texto traduzido", async () => {
    mocks.grant.mockRejectedValue(new ApiError(409, "reused", "IDEMPOTENCY_KEY_REUSED"));
    setup(); open(); fill(); submit();
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(messages.ApiErrors.idempotency_key_reused));
  });

  it("notifyUser começa desmarcado e é enviado como false", async () => {
    mocks.grant.mockResolvedValue({ tenantId: "t-1", amount: 3, balance: 3, replayed: false });
    setup(); open();
    expect((screen.getByLabelText(t.notify) as HTMLInputElement).checked).toBe(false);
    fill("3"); submit();
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(mocks.grant).toHaveBeenCalled());
    expect(mocks.grant.mock.calls[0][1].notifyUser).toBe(false);
  });

  it("replayed: true mostra a mensagem de repetição e chama onGranted", async () => {
    mocks.grant.mockResolvedValue({ tenantId: "t-1", amount: 10, balance: 42, replayed: true });
    const { onGranted } = setup(); open(); fill(); submit();
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(screen.getByText(t.successReplayed.replace("{balance}", "42"))).toBeTruthy());
    expect(onGranted).toHaveBeenCalledTimes(1);
  });
});
