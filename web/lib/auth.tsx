"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import posthog from "posthog-js";
import { ApiError, auth, onUnauthorized, setCsrfToken, setFiscalEnvironment, getFiscalEnvironment, type SessionPayload } from "./api";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";
interface AuthContextType {
  session: SessionPayload | null; status: AuthStatus; error: string | null;
  tenantId: string | null; permissions: string[]; profile: SessionPayload["profile"] | null; isLoading: boolean; isAuthenticated: boolean;
  fiscalEnvironment: "test" | "live"; switchFiscalEnvironment: (env: "test" | "live") => void;
  refreshSession: () => Promise<void>;
  verifyCode: (email: string, challengeId: string, code: string, onVerified?: (isNewUser: boolean) => void) => Promise<void>;
  logout: () => Promise<void>; switchTenant: (tenantId: string) => Promise<void>;
  can: (permission: string) => boolean;
}
const AuthContext = createContext<AuthContextType | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [fiscalEnvironment, setFiscalEnv] = useState<"test" | "live">("test");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const transition = useRef(false);
  const identifiedUserId = useRef<string | null>(null);
  const clear = useCallback(() => {
    generation.current++; controller.current?.abort();
    if (posthogConfigured && (identifiedUserId.current || posthog.get_property("$user_id"))) posthog.reset();
    identifiedUserId.current = null;
    setCsrfToken(null); setSession(null); setStatus("anonymous"); setError(null);
  }, []);
  const apply = useCallback((value: SessionPayload) => {
    const userId = value.context.authUserId;
    if (posthogConfigured && identifiedUserId.current !== userId) {
      const persistedUserId = posthog.get_property("$user_id");
      if (identifiedUserId.current || (typeof persistedUserId === "string" && persistedUserId !== userId)) posthog.reset();
      posthog.identify(userId, { role: value.context.role });
      identifiedUserId.current = userId;
    }
    setCsrfToken(value.csrfToken); setSession(value); setStatus("authenticated"); setError(null);
  }, []);
  const refreshSession = useCallback(async () => {
    if (transition.current) return;
    const current = ++generation.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try {
      const value = await auth.session(abort.signal);
      if (generation.current === current) apply(value);
    } catch (cause) {
      if (generation.current !== current || abort.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) { clear(); return; }
      setError(cause instanceof Error ? cause.message : "Session unavailable"); setStatus("error");
    }
  }, [apply, clear]);
  useEffect(() => {
    // Initialize fiscal environment from localStorage
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    setFiscalEnv(getFiscalEnvironment());
    // One-time cleanup of the old identity cache; it is never an auth source.
    try { localStorage.removeItem("corvo_user"); sessionStorage.removeItem("corvo_user"); } catch {}
    const unsubscribe = onUnauthorized(clear);
    const lifecycle = generation;
    queueMicrotask(() => { void refreshSession(); });
    const onFocus = () => { void refreshSession(); };
    window.addEventListener("focus", onFocus);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("corvo-session");
      channel.current.onmessage = () => { void refreshSession(); };
    }
    // Sync fiscal environment across tabs
    const onEnvironmentChange = (e: StorageEvent) => {
      if (e.key === "corvo_fiscal_environment" && e.newValue) {
        const env = e.newValue as "test" | "live";
        setFiscalEnv(env);
        window.dispatchEvent(new CustomEvent("fiscal-environment-change", { detail: env }));
      }
    };
    window.addEventListener("storage", onEnvironmentChange);
    return () => { lifecycle.current++; controller.current?.abort(); unsubscribe(); window.removeEventListener("focus", onFocus); channel.current?.close(); window.removeEventListener("storage", onEnvironmentChange); };
  }, [clear, refreshSession]);
  const verifyCode = async (email: string, challengeId: string, code: string, onVerified?: (isNewUser: boolean) => void) => {
    if (transition.current) throw new Error("Session update in progress.");
    transition.current = true;
    const current = ++generation.current; controller.current?.abort();
    try {
    const verified = await auth.magicLinkVerify(email, challengeId, code);
    if (current !== generation.current) throw new Error("Session changed. Please try again.");
    setCsrfToken(verified.csrfToken); onVerified?.(verified.isNewUser);
    const value = await auth.session();
    if (current !== generation.current) throw new Error("Session changed. Please try again.");
    apply(value); channel.current?.postMessage("refresh");
    } finally { transition.current = false; }
  };
  const logout = async () => {
    if (transition.current) throw new Error("Session update in progress.");
    transition.current = true;
    generation.current++; controller.current?.abort();
    try {
    try { await auth.logout(); }
    catch (cause) { if (!(cause instanceof ApiError && cause.status === 401)) throw cause; }
    clear(); channel.current?.postMessage("refresh");
    } finally { transition.current = false; }
  };
  const switchTenant = async (tenantId: string) => {
    if (transition.current) throw new Error("Session update in progress.");
    transition.current = true;
    const current = ++generation.current; controller.current?.abort(); setStatus("loading");
    try {
      const value = await auth.switchTenant(tenantId);
      if (current !== generation.current) return;
      apply({ ...value, status: "authenticated" }); channel.current?.postMessage("refresh");
    } catch (cause) {
      if (current === generation.current) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Session unavailable"); }
      throw cause;
    } finally { transition.current = false; }
  };
  const can = useCallback((permission: string) => session?.permissions.includes(permission) ?? false, [session]);
  const switchFiscalEnvironment = useCallback((env: "test" | "live") => {
    setFiscalEnv(env);
    setFiscalEnvironment(env);
  }, []);
  return <AuthContext.Provider value={{ session, status, error, tenantId: session?.activeTenantId ?? null, permissions: session?.permissions ?? [], profile: session?.profile ?? null, isLoading: status === "loading", isAuthenticated: status === "authenticated", fiscalEnvironment, switchFiscalEnvironment, refreshSession, verifyCode, logout, switchTenant, can }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
