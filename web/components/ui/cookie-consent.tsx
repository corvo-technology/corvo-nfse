"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { acceptCookies } from "@/lib/consent";
import { CorvoLogo } from "./corvo-logo";

export function CookieConsent() {
  const pathname = usePathname();
  const locale = pathname.match(/^\/(en|pt)(?:\/|$)/)?.[1] ?? "en";
  const [animateIn, setAnimateIn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimateIn(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  function handleAccept() { acceptCookies(); }

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 ease-out ${
        animateIn
          ? "translate-y-0 opacity-100"
          : "translate-y-full opacity-0"
      }`}
    >
      <div className="bg-surface border-t border-border">
        <div className="mx-auto max-w-[1120px] px-6 sm:px-10 py-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {/* Logo + text */}
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="mt-0.5 shrink-0">
                <CorvoLogo size={18} variant="green" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-[13.5px] text-text-2 leading-relaxed">
                  We use cookies to improve your experience and analyze site
                  traffic. By clicking &ldquo;Accept&rdquo;, you agree to our
                  use of cookies.
                </p>
                <Link
                  href={`/${locale}/privacy`}
                  className="text-[12.5px] text-text-4 hover:text-text-2 transition-colors"
                >
                  Learn more about our privacy practices
                </Link>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto">
              <button
                onClick={handleAccept}
                className="flex-1 sm:flex-none bg-[#ededec] text-[#0a0a0a] rounded-[8px] px-5 py-2.5 text-[13.5px] font-medium transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
