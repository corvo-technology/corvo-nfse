"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, HelpCircle, Mail, MessageCircle, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSupportContacts } from "@/lib/support-contacts-context";
import { hasSupportContacts } from "@/lib/support-contacts";
import { cn } from "@/lib/utils";

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

function OwnerAvatar({ url }: { url: string | null }) {
  return (
    <span className="relative flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#232323] text-text-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" /> : <HelpCircle size={15} aria-hidden />}
      <span aria-hidden className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-bg bg-[#25d366] text-black">
        <MessageCircle size={7} strokeWidth={3} />
      </span>
    </span>
  );
}

const pill = "flex h-10 items-center gap-2.5 rounded-full border border-border bg-surface-alt pl-1.5 pr-3.5 text-left transition-colors hover:bg-hover";

/** Two compact pills for wide screens. Renders only the contacts that are set. */
export function SupportPills() {
  const t = useTranslations("Support");
  const c = useSupportContacts();
  if (!c.communityUrl && !c.whatsappUrl) return null;
  return (
    <div className="hidden items-center gap-2 xl:flex">
      {c.communityUrl && (
        <a href={c.communityUrl} {...EXTERNAL} className={pill}>
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#232323] text-text-3"><Users size={15} aria-hidden /></span>
          <span className="flex flex-col leading-tight">
            <span className="text-[12.5px] font-medium text-text">{t("community")}</span>
            <span className="text-[11.5px] text-text-3">{t("communityHint")}</span>
          </span>
        </a>
      )}
      {c.whatsappUrl && (
        <a href={c.whatsappUrl} {...EXTERNAL} className={pill}>
          <OwnerAvatar url={c.avatarUrl} />
          <span className="flex flex-col leading-tight">
            <span className="text-[12.5px] font-medium text-text">{t("needHelp")}</span>
            <span className="text-[11.5px] text-text-3">{t("needHelpHint")}</span>
          </span>
        </a>
      )}
    </div>
  );
}

/** The options as a list of links, shared by the dropdown and the sidebar. */
export function SupportLinks({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const t = useTranslations("Support");
  const c = useSupportContacts();
  const item = "flex min-h-10 items-center gap-3 rounded-[8px] px-3 text-[14px] text-text-3 transition-colors hover:bg-hover hover:text-text";
  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {c.whatsappUrl && (
        <li><a href={c.whatsappUrl} {...EXTERNAL} onClick={onNavigate} className={item}><MessageCircle size={16} aria-hidden className="flex-none text-text-4" />{t("whatsapp")}</a></li>
      )}
      {c.communityUrl && (
        <li><a href={c.communityUrl} {...EXTERNAL} onClick={onNavigate} className={item}><Users size={16} aria-hidden className="flex-none text-text-4" />{t("group")}</a></li>
      )}
      {c.email && (
        <li><a href={`mailto:${c.email}`} onClick={onNavigate} className={item}><Mail size={16} aria-hidden className="flex-none text-text-4" />{t("email")}</a></li>
      )}
    </ul>
  );
}

/** Single "Ajuda" button with a small menu, for narrower screens. */
export function SupportMenu({ className }: { className?: string }) {
  const t = useTranslations("Support");
  const c = useSupportContacts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!hasSupportContacts(c)) return null;
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface-alt px-3 text-[13px] text-text-2 transition-colors hover:bg-hover hover:text-text"
      >
        <HelpCircle size={15} aria-hidden />
        {t("help")}
        <ChevronDown size={13} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={menuId} className="absolute right-0 top-11 z-30 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
          <SupportLinks onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** "Ajuda" entry for the sidebar (also the mobile drawer): same options, always visible. */
export function SidebarHelp({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("Support");
  const c = useSupportContacts();
  if (!hasSupportContacts(c)) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="eyebrow px-3 py-1 text-text-5">{t("help")}</p>
      <SupportLinks onNavigate={onNavigate} />
    </div>
  );
}
