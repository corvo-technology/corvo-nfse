"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";

const rawPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const PIXEL_ID = rawPixelId && /^\d{5,20}$/.test(rawPixelId) ? rawPixelId : undefined;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

/** Fires a Pixel event; a no-op without a configured Pixel or before the stub has loaded. */
export function trackMeta(
  event: string,
  params: Record<string, unknown> = {},
  eventId?: string
) {
  if (!PIXEL_ID || typeof window === "undefined" || !window.fbq) return;
  if (eventId) window.fbq("track", event, params, { eventID: eventId });
  else window.fbq("track", event, params);
}

export function MetaPixel() {
  const pathname = usePathname();

  useEffect(() => {
    if (!PIXEL_ID || pathname.startsWith("/app")) return;
    window.fbq?.("track", "PageView");
  }, [pathname]);

  if (!PIXEL_ID) return null;

  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('set', 'autoConfig', false, '${PIXEL_ID}');
        fbq('init', '${PIXEL_ID}');
      `}
    </Script>
  );
}
