"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface SidebarGroup {
  label: string;
  items: { slug: string; title: string; href: string }[];
}

export function DocsSidebar({
  homeLabel,
  homeHref,
  groups,
  closeLabel,
  menuLabel,
}: {
  homeLabel: string;
  homeHref: string;
  groups: SidebarGroup[];
  closeLabel: string;
  menuLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href;

  const nav = (
    <nav aria-label="Docs" className="space-y-6 p-5">
      <div>
        <Link
          href={homeHref}
          onClick={() => setOpen(false)}
          className={`block text-sm ${isActive(homeHref) ? "text-accent" : "text-text-2 hover:text-text"}`}
        >
          {homeLabel}
        </Link>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="border-t border-border pt-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-4">
            {group.label}
          </p>
          <ul className="mt-2 space-y-1">
            {group.items.map((item) => (
              <li key={item.slug}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block border-l-2 pl-3 text-sm transition-colors ${
                    isActive(item.href)
                      ? "border-accent text-accent"
                      : "border-transparent text-text-2 hover:text-text"
                  }`}
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 rounded-full border border-border bg-surface px-4 py-2 text-sm text-text-2 shadow-lg lg:hidden"
        aria-expanded={open}
        aria-controls="docs-sidebar"
      >
        {menuLabel}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        id="docs-sidebar"
        className={`fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r border-border bg-bg lg:sticky lg:top-0 lg:block lg:h-screen lg:translate-x-0 lg:bg-transparent ${
          open ? "translate-x-0" : "-translate-x-full"
        } transition-transform lg:transition-none`}
      >
        <div className="flex items-center justify-between p-4 lg:hidden">
          <span className="font-mono text-xs uppercase tracking-widest text-text-4">
            {closeLabel}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={closeLabel}
            className="text-text-3 hover:text-text"
          >
            ✕
          </button>
        </div>
        {nav}
      </aside>
    </>
  );
}
