"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, ApiError, type MagicLinkChallenge, type OAuthProvider, type OAuthProviders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCookieConsent } from "@/lib/consent";
import { markPendingCompleteRegistration } from "@/lib/complete-registration";
import { safeNextPath } from "@/lib/safe-next";
import { cn } from "@/lib/utils";
import { trackMeta } from "@/components/MetaPixel";
import { CorvoWordmark } from "@/components/ui/corvo-logo";

type Mode = "signup" | "login";
type Step = "email" | "code";

const PERK_KEYS = ["nfse", "multiCompany", "automation", "simpleApi"] as const;

const socialBtn =
  "group relative flex items-center justify-center gap-2.5 w-full rounded-[10px] border border-white/[0.09] bg-white/[0.03] px-4 py-3 text-[14px] font-medium text-text transition-all hover:border-white/20 hover:bg-white/[0.06] active:scale-[0.99] cursor-pointer";

function ErrorBox({ message }: { message: string }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 flex w-full items-start gap-2.5 rounded-[10px] border border-[#3a2218] bg-[#1c1210] px-4 py-3"
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger/20 text-[10px] font-bold text-danger">
        !
      </span>
      <span className="text-[13px] leading-relaxed text-danger">{message}</span>
    </motion.div>
  );
}

const OAUTH_ERRORS = new Set(["oauth_failed", "oauth_denied", "oauth_unavailable", "oauth_email_unverified"]);

function LoginPageContent() {
  const locale = useLocale();
  const t = useTranslations("Login");
  const tCommon = useTranslations("Common");
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "login" ? "login" : "signup";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(() => {
    const code = searchParams.get("error");
    return code && OAUTH_ERRORS.has(code) ? t(`errors.${code}`) : "";
  });
  const [providers, setProviders] = useState<OAuthProviders>({ google: false, github: false });
  const [loading, setLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // Where to go after login (e.g. back to the AI-agent consent screen).
  const afterLogin = safeNextPath(searchParams.get("next")) ?? "/app";

  const { verifyCode, refreshSession, isAuthenticated } = useAuth();
  const consent = useCookieConsent();
  const [challenge, setChallenge] = useState<MagicLinkChallenge | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [cookieIssued, setCookieIssued] = useState(false);
  const busy = useRef(false);
  const waitSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const expired = challenge !== null && now >= Date.parse(challenge.expiresAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (isAuthenticated) router.replace(afterLogin); }, [isAuthenticated, router, afterLogin]);
  // Social buttons only work when the server has the provider configured.
  useEffect(() => {
    let cancelled = false;
    auth.oauthProviders().then((value) => { if (!cancelled) setProviders(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const startSocial = (provider: OAuthProvider) => {
    window.location.assign(auth.oauthStartUrl(provider, afterLogin === "/app" ? undefined : afterLogin));
  };
  const showError = (cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 429) {
      setCooldownUntil(Date.now() + (cause.retryAfterSeconds ?? 60) * 1000);
      setError(t("errors.tooManyAttempts"));
    } else if (cause instanceof ApiError && cause.status === 401) {
      setCode(""); setError(t("errors.invalidCredentials"));
    } else if (cause instanceof ApiError && cause.status === 409) {
      setError(t("errors.workspaceConflict"));
    } else if (cause instanceof ApiError && [0, 502, 503].includes(cause.status)) {
      setError(t("errors.serviceUnavailable"));
    } else {
      setError(cause instanceof ApiError && cause.status === 400 ? cause.message : t("errors.somethingWentWrong"));
    }
  };
  const handleSendCode = async () => {
    if (!email.trim() || busy.current || Date.now() < cooldownUntil) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t("errors.invalidEmail")); return; }
    const isFirstSend = mode === "signup" && !challenge;
    busy.current = true; setError(""); setLoading(true);
    try {
      const issued = await auth.magicLinkRequest(email.trim());
      if (isFirstSend) trackMeta("Lead", {}, crypto.randomUUID());
      setChallenge(issued); setCooldownUntil(Date.parse(issued.resendAvailableAt));
      setNow(Date.now()); setCode(""); setCookieIssued(false); setStep("code");
    } catch (cause) { showError(cause); }
    finally { busy.current = false; setLoading(false); }
  };
  const handleVerifyCode = async (candidate = code) => {
    if (!challenge || candidate.length !== 6 || busy.current || cookieIssued) return;
    if (Date.now() >= Date.parse(challenge.expiresAt)) { setError(t("errors.expiredCode")); return; }
    busy.current = true; setError(""); setLoading(true);
    try {
      await verifyCode(email.trim(), challenge.challengeId, candidate, (isNewUser) => {
        setCookieIssued(true);
        if (isNewUser && consent === "accepted") markPendingCompleteRegistration(crypto.randomUUID());
      });
      router.replace(afterLogin);
    } catch (cause) { showError(cause); }
    finally { busy.current = false; setLoading(false); }
  };
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(next);
    if (next.length === 6) void handleVerifyCode(next);
  };
  const changeMode = (next: Mode) => {
    if (busy.current) return;
    setMode(next); setStep("email"); setEmail(""); setCode(""); setChallenge(null); setError(""); setCookieIssued(false);
  };

  const title =
    step === "code"
      ? t("magicLink.enterCode")
      : mode === "signup"
        ? t("signupTitle")
        : t("loginTitle");

  const subtitle =
    step === "code"
      ? t("magicLink.codeSent", { email })
      : mode === "signup"
        ? t("signupSubtitle")
        : t("loginSubtitle");

  return (
    <div className="grid min-h-screen grid-cols-1 bg-bg font-sans text-text lg:grid-cols-[1fr_480px]">
      {/* Left column -- form */}
      <div className="relative flex flex-col items-center justify-center overflow-hidden p-6 sm:p-12">
        {/* atmosphere */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse 60% 55% at 50% 42%, black, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse 60% 55% at 50% 42%, black, transparent 75%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[18%] h-[320px] w-[420px] -translate-x-1/2 rounded-full bg-accent/[0.09] blur-[110px]"
        />

        <div className="relative flex w-full max-w-[400px] flex-col items-center">
          <Link href="/" aria-label={tCommon("brand")} className="mb-9 transition-opacity hover:opacity-80">
            <CorvoWordmark size={17} variant="green" />
          </Link>

          <div className="w-full rounded-2xl border border-white/[0.07] bg-[#0c0c0c]/80 p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:p-8">
            {/* Mode switch */}
            {step === "email" && (
              <div className="relative mb-7 grid grid-cols-2 rounded-full border border-white/[0.07] bg-[#101010] p-1">
                {(["signup", "login"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => changeMode(m)}
                    disabled={loading}
                    className={cn(
                      "relative rounded-full py-2 text-[13px] font-medium transition-colors cursor-pointer",
                      mode === m ? "text-text" : "text-text-3 hover:text-text-2"
                    )}
                  >
                    {mode === m && (
                      <motion.span
                        layoutId="auth-mode"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        className="absolute inset-0 rounded-full bg-[#1d1d1d] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      />
                    )}
                    <span className="relative">
                      {m === "signup" ? t("createAccount") : t("signIn")}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${step}-${mode}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <h1 className="mb-2 text-center text-[23px] font-semibold tracking-[-0.03em]">
                  {title}
                </h1>
                <p className="mx-auto mb-7 max-w-[320px] text-center text-[14px] leading-relaxed text-text-3">
                  {subtitle}
                </p>

                {step === "email" && (
                  <>
                    {/* Social buttons */}
                    <div className="mb-6 flex w-full flex-col gap-2.5">
                      <button
                        type="button"
                        disabled={!providers.google}
                        title={providers.google ? undefined : t("socialUnavailable")}
                        onClick={() => startSocial("google")}
                        className={cn(socialBtn, !providers.google && "opacity-40 cursor-not-allowed")}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        {mode === "signup" ? t("signUpWithGoogle") : t("signInWithGoogle")}
                      </button>

                      <button
                        type="button"
                        disabled={!providers.github}
                        title={providers.github ? undefined : t("socialUnavailable")}
                        onClick={() => startSocial("github")}
                        className={cn(socialBtn, !providers.github && "opacity-40 cursor-not-allowed")}
                      >
                        <svg className="h-4 w-4 fill-text" viewBox="0 0 24 24" aria-hidden>
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        {mode === "signup" ? t("signUpWithGitHub") : t("signInWithGitHub")}
                      </button>
                    </div>

                    {/* Divider */}
                    <div className="mb-6 flex w-full items-center gap-4">
                      <div className="h-px flex-1 bg-white/[0.07]" />
                      <span className="font-mono text-[11px] tracking-wide text-text-5">
                        {tCommon("or")}
                      </span>
                      <div className="h-px flex-1 bg-white/[0.07]" />
                    </div>

                    <input
                      type="email"
                      autoComplete="email"
                      aria-label={t("emailPlaceholder")}
                      placeholder={t("emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSendCode();
                        }
                      }}
                      className="mb-4 w-full rounded-[10px] border border-white/[0.09] bg-[#101010] px-4 py-3 text-[14.5px] text-text outline-none transition-all placeholder:text-text-5 focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(52,211,153,0.08)]"
                    />

                    {error && <ErrorBox message={error} />}

                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={loading || !email.trim() || waitSeconds > 0}
                      className="w-full cursor-pointer rounded-[10px] bg-[#ededec] p-3 text-center text-[14.5px] font-medium text-[#0a0a0a] shadow-[inset_0_-1px_0_rgba(0,0,0,0.15)] transition-all hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {loading ? t("magicLink.sending") : t("magicLink.sendCode")}
                    </button>
                  </>
                )}

                {step === "code" && (
                  <>
                    {/* 6-digit code: one real input, six visual cells */}
                    <div
                      className="relative mb-4 cursor-text"
                      onClick={() => codeInputRef.current?.focus()}
                    >
                      <div className="grid grid-cols-6 gap-2">
                        {Array.from({ length: 6 }).map((_, i) => {
                          const filled = i < code.length;
                          const current = i === code.length;
                          return (
                            <div
                              key={i}
                              className={cn(
                                "flex h-14 items-center justify-center rounded-[10px] border bg-[#101010] font-mono text-[22px] font-medium transition-all",
                                current
                                  ? "border-accent/70 shadow-[0_0_0_4px_rgba(52,211,153,0.08)]"
                                  : filled
                                    ? "border-white/20"
                                    : "border-white/[0.09]"
                              )}
                            >
                              {code[i] ?? (
                                <span className="text-[16px] text-text-5">·</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <input
                        ref={codeInputRef}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        aria-label={t("magicLink.enterCode")}
                        value={code}
                        disabled={loading || expired || cookieIssued}
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void handleVerifyCode(); } }}
                        onChange={handleCodeChange}
                        autoFocus
                        className="absolute inset-0 h-full w-full cursor-text opacity-0"
                      />
                    </div>

                    {(error || expired) && <ErrorBox message={error || t("errors.expiredCode")} />}
                    {cookieIssued && <button className="btn btn-secondary mb-4 w-full" onClick={() => void refreshSession()}>{t("retrySession")}</button>}

                    <button
                      type="button"
                      onClick={() => void handleVerifyCode()}
                      disabled={loading || code.length !== 6 || expired || cookieIssued}
                      className="mb-4 w-full cursor-pointer rounded-[10px] bg-[#ededec] p-3 text-center text-[14.5px] font-medium text-[#0a0a0a] transition-all hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {loading ? t("magicLink.sending") : t("magicLink.verifyCode")}
                    </button>

                    <div className="flex items-center justify-between text-[13px]">
                      <button
                        type="button"
                        onClick={() => {
                          setError("");
                          setCode("");
                          setStep("email"); setChallenge(null); setCookieIssued(false);
                        }}
                        disabled={loading}
                        className="cursor-pointer text-text-3 transition-colors hover:text-text"
                      >
                        ← {t("magicLink.back")}
                      </button>
                      <button
                        type="button"
                        onClick={handleSendCode}
                        disabled={loading || waitSeconds > 0 || cookieIssued}
                        className="cursor-pointer text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
                      >
                        {waitSeconds > 0 ? t("magicLink.resendHint", { n: waitSeconds }) : t("magicLink.resend")}
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Terms (signup only) */}
          {step === "email" && mode === "signup" && (
            <p className="mt-6 max-w-[320px] text-center text-[11.5px] leading-relaxed text-text-5">
              {t.rich("termsNote", {
                terms: (chunks) => <Link href={`/${locale}/terms`} className="underline hover:text-text-2">{chunks}</Link>,
                privacy: (chunks) => <Link href={`/${locale}/privacy`} className="underline hover:text-text-2">{chunks}</Link>,
              })}
            </p>
          )}
        </div>
      </div>

      {/* Right column -- value panel */}
      <div className="relative hidden flex-col justify-center gap-8 overflow-hidden border-l border-border bg-surface-alt p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent/[0.12] blur-[100px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
            maskImage: "linear-gradient(to bottom, black, transparent 60%)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent 60%)",
          }}
        />

        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <span className="w-fit rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[10.5px] tracking-[0.12em] text-accent">
              {t("freeCreditsTag")}
            </span>
            <h2 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.035em]">
              {t("headline")}
            </h2>
          </div>

          <div className="flex flex-col gap-5">
            {PERK_KEYS.map((key, i) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.07, duration: 0.4, ease: "easeOut" }}
                className="flex gap-3.5"
              >
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-accent/30 bg-accent/10">
                  <svg viewBox="0 0 16 16" className="h-3 w-3 text-accent" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 8.5l3.2 3L13 4.5" />
                  </svg>
                </span>
                <div>
                  <p className="mb-0.5 text-[14px] font-medium text-text">
                    {t(`perks.${key}.title`)}
                  </p>
                  <p className="text-[13px] leading-relaxed text-text-3">
                    {t(`perks.${key}.desc`)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Code snippet */}
          <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#0d0d0d]">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
              <span className="h-2 w-2 rounded-full bg-accent" />
              <span className="font-mono text-[10px] tracking-[0.12em] text-text-4">
                {t("afterSignup")}
              </span>
            </div>
            <div className="px-4 py-3.5 font-mono text-[12px] leading-[1.85]">
              <div>
                <span className="text-text-2">CORVO_API_KEY=</span>
                <span className="text-[#8fd6a0]">&lt;sua-chave-de-integração&gt;</span>
              </div>
              <div className="mt-1.5 text-text-3">
                <span className="text-text">curl</span> -X POST api.corvo.tech/v1/invoices \
              </div>
              <div className="pl-4 text-text-3">
                -H <span className="text-[#8fd6a0]">&quot;x-api-key: $CORVO_API_KEY&quot;</span>
              </div>
            </div>
          </div>

          <p className="text-[13px] leading-relaxed text-text-4">{t("footerNote")}</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
