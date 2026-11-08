"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError, invitations, type InvitationPreview } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CorvoWordmark } from "@/components/ui/corvo-logo";

const TOKEN_KEY = "corvo_invite_token";

/**
 * The e-mail link carries the token in the URL fragment (`#token=…`), which the browser never sends to a server.
 * It is moved to sessionStorage and removed from the address bar before anything else happens, so it
 * survives the sign-in round trip without sitting in the URL, history or a referrer.
 */
function takeToken(): string | null {
  try {
    const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (fromLink) {
      sessionStorage.setItem(TOKEN_KEY, fromLink);
      window.history.replaceState(null, "", window.location.pathname);
    }
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function forgetToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

type Problem = "invalid" | "expired" | "mismatch" | "missing" | "failed";

function problemOf(error: unknown): Problem {
  if (error instanceof ApiError) {
    const code = String(error.code ?? "").toLowerCase();
    if (code === "invitation_expired") return "expired";
    if (code === "invitation_email_mismatch") return "mismatch";
    if (code === "invitation_invalid") return "invalid";
  }
  return "failed";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-4 py-10 text-text">
      <CorvoWordmark size={18} variant="green" />
      <Card className="w-full max-w-[460px] p-6">{children}</Card>
    </div>
  );
}

export default function AcceptInvitePage() {
  const t = useTranslations("AcceptInvite");
  const tc = useTranslations("Members.roles");
  const router = useRouter();
  const { status, switchTenant, logout } = useAuth();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [accepting, setAccepting] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the fragment is only readable after hydration
  useEffect(() => { setToken(takeToken()); }, []);

  // Not signed in: sign in with the invited e-mail and come back here (the token waits in sessionStorage).
  useEffect(() => {
    if (status === "anonymous" && token) router.replace(`/login?next=${encodeURIComponent("/accept-invite")}`);
  }, [status, token, router]);

  useEffect(() => {
    if (status !== "authenticated" || token === undefined) return;
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no token is only known after hydration
      setProblem("missing");
      return;
    }
    const controller = new AbortController();
    invitations
      .preview(token)
      .then((value) => !controller.signal.aborted && setPreview(value))
      .catch((cause: unknown) => !controller.signal.aborted && setProblem(problemOf(cause)));
    return () => controller.abort();
  }, [status, token]);

  const accept = useCallback(async () => {
    if (!token || accepting) return;
    setAccepting(true);
    try {
      const { tenantId } = await invitations.accept(token);
      forgetToken();
      await switchTenant(tenantId);
      router.replace("/app");
    } catch (cause) {
      setProblem(problemOf(cause));
      setAccepting(false);
    }
  }, [token, accepting, switchTenant, router]);

  const switchAccount = async () => {
    await logout();
    router.replace(`/login?next=${encodeURIComponent("/accept-invite")}`);
  };

  if (token === undefined || status === "loading" || (status === "authenticated" && !preview && !problem) || status === "anonymous" && token) {
    return <Shell><p role="status" className="text-[14px] text-text-3">{t("loading")}</p></Shell>;
  }

  if (problem) {
    const spent = problem === "invalid" || problem === "expired";
    return (
      <Shell>
        <p role="alert" className="text-[14.5px] text-text-2">{t(problem)}</p>
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          {problem === "mismatch" && <Button variant="accent" onClick={() => void switchAccount()}>{t("switchAccount")}</Button>}
          {(spent || problem === "missing" || problem === "failed") && status === "authenticated" && (
            <Button variant="secondary" onClick={() => { if (spent || problem === "missing") forgetToken(); router.replace("/app"); }}>{t("goHome")}</Button>
          )}
        </div>
      </Shell>
    );
  }

  if (!preview) return <Shell><p role="alert" className="text-[14.5px] text-text-2">{t("missing")}</p></Shell>;

  const role = tc.has(`${preview.role}.label`) ? tc(`${preview.role}.label`) : preview.role;
  return (
    <Shell>
      <div className="flex flex-col gap-4">
        <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg"><MailCheck size={18} /></span>
        <h1 className="text-[18px] font-semibold">{t("title")}</h1>
        <p className="text-[14.5px] text-text-2">
          {preview.invitedBy ? t("subtitle", { invitedBy: preview.invitedBy, role }) : t("subtitleNoName", { role })}
        </p>
        <Button variant="accent" loading={accepting} onClick={() => void accept()}>
          {accepting ? t("accepting") : t("accept")}
        </Button>
      </div>
    </Shell>
  );
}
