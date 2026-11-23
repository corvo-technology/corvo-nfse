import Link from "next/link";
import { CorvoWordmark } from "@/components/ui/corvo-logo";
import { rootMetadata } from "@/lib/root-metadata";
import "./globals.css";

// The app has two root layouts ([locale] and (dashboard)), so unmatched URLs use this page.
export const metadata = {
  ...rootMetadata,
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
    <div className="min-h-screen bg-bg text-text font-sans flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border-soft px-6 sm:px-10 py-4 flex items-center justify-between">
        <Link href="/pt">
          <CorvoWordmark size={16} variant="green" />
        </Link>
        <Link
          href="/pt"
          className="text-sm text-text-3 hover:text-text transition-colors"
        >
          Back to home
        </Link>
      </nav>

      {/* Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center text-center max-w-[480px]">
          {/* Large 404 */}
          <div className="relative mb-8">
            <span
              className="text-[120px] sm:text-[160px] font-semibold tracking-[-0.05em] leading-none text-transparent"
              style={{
                WebkitTextStroke: "1px #1f1f1f",
              }}
            >
              404
            </span>
            <div className="absolute inset-0 flex items-center justify-center">
              <svg
                viewBox="14 13 50 37"
                width="48"
                height="36"
                className="opacity-40"
              >
                <path
                  d="M17 44L21 21L39 16L45 25L20 47Z"
                  fill="currentColor"
                  className="text-accent"
                />
                <path
                  d="M39 16L45 25L61 26L45 30L41 44L20 47Z"
                  fill="currentColor"
                  className="text-accent"
                  fillOpacity="0.4"
                />
                <circle cx="33" cy="24.5" r="2.4" fill="#0a0a0a" />
              </svg>
            </div>
          </div>

          {/* Message */}
          <h1 className="text-[22px] font-semibold tracking-tight mb-3">
            Page not found
          </h1>
          <p className="text-[15px] text-text-3 leading-relaxed mb-8">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Link
              href="/pt"
              className="inline-flex items-center justify-center bg-[#ededec] text-[#0a0a0a] px-5 py-2.5 rounded-[8px] text-[14px] font-medium transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
            >
              Go home
            </Link>
            <Link
              href="/app"
              className="inline-flex items-center justify-center border border-border-strong px-5 py-2.5 rounded-[8px] text-[14px] text-[#d4d4d4] transition-[color,background-color,border-color,opacity,transform,box-shadow] hover:bg-white/[0.04] hover:scale-[1.02] active:scale-[0.98]"
            >
              Open dashboard
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border-soft px-6 sm:px-10 py-5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="font-mono text-xs text-text-4">
            www.corvo.tech
          </span>
          <div className="flex items-center gap-1 font-mono text-xs text-text-4">
            <Link href="/pt/status" className="hover:text-text-2 transition-colors">Status</Link>
            <span>·</span>
            <Link href="/pt/docs" className="hover:text-text-2 transition-colors">API</Link>
            <span>·</span>
            <Link href="/pt/security" className="hover:text-text-2 transition-colors">Security</Link>
            <span>·</span>
            <Link href="/pt/terms" className="hover:text-text-2 transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
      </body>
    </html>
  );
}
