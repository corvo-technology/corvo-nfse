"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { needsName } from "@/lib/profile-name";
import { NameForm } from "@/components/profile/name-form";
import { Button } from "@/components/ui/button";

const skippedKey = (authUserId: string) => `corvo_name_prompt_skipped:${authUserId}`;
const wasSkipped = (authUserId: string) => { try { return sessionStorage.getItem(skippedKey(authUserId)) === "1"; } catch { return false; } };

/**
 * First access: a full screen that asks "what should we call you?" before anything else.
 * Nothing else in the account collects a name, so without this the e-mails and the team list
 * would only have the part of the e-mail before the "@". It can be skipped, once per browser session.
 */
export function ProfileNamePrompt() {
  const t = useTranslations("Profile");
  const { profile, session } = useAuth();
  const authUserId = session?.context.authUserId ?? "";
  const [skipped, setSkipped] = useState(false);

  if (!needsName(profile) || skipped || (authUserId && wasSkipped(authUserId))) return null;

  const skip = () => {
    try { sessionStorage.setItem(skippedKey(authUserId), "1"); } catch {}
    setSkipped(true);
  };

  return (
    <section aria-labelledby="name-prompt-title" className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-5 py-10">
        <div className="flex w-full max-w-[460px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 id="name-prompt-title" className="text-balance text-[28px] font-semibold leading-[1.1] tracking-tight">{t("promptTitle")}</h1>
            <p className="text-pretty text-[15px] leading-relaxed text-text-3">{t("promptBody")}</p>
          </div>
          <NameForm submitLabel={t("continue")} />
          <Button variant="ghost" className="self-start" onClick={skip}>{t("skip")}</Button>
        </div>
      </div>
    </section>
  );
}
