import { ArrowUpRight, Star } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Facet } from "@/components/ui/facet";
import { REPO_URL, SELF_HOSTING_URL } from "@/lib/repo";

const ROWS = ["price", "operator", "data", "updates", "setup", "support"] as const;

// Same commands as the "Local testing" section of SELF_HOSTING.md.
const COMMANDS = [
  `git clone ${REPO_URL}.git`,
  "cd corvo-nfse",
  "node scripts/setup-env.mjs",
  "docker compose --env-file deploy/.env.local \\",
  "  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml \\",
  "  up -d --build --wait --wait-timeout 180",
];

const CTA_BASE =
  "inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] px-5.5 py-3 text-[15px] transition-[background-color,opacity,transform] active:scale-[0.98] sm:w-auto";

export function OpenSourceSection() {
  const t = useTranslations("LandingOpenSource");

  return (
    <section id="open-source" className="mx-auto max-w-[1120px] scroll-mt-20 px-6 py-16 sm:px-10 sm:py-24">
      <h2 className="max-w-[620px] text-balance text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.02] tracking-[-0.035em] text-text">{t("title")}</h2>
      <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-text-3 text-pretty">{t("description")}</p>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {(["cloud", "selfHosted"] as const).map((key) => (
          <div key={key} className="flex min-w-0 flex-col rounded-[8px] border border-border-strong bg-[#0a0a0a] p-6">
            <h3 className="flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.02em] text-text">
              <Facet />
              {t(`${key}.name`)}
            </h3>
            <p className="mt-2 text-[14px] leading-relaxed text-text-3">{t(`${key}.tagline`)}</p>
            <dl className="mt-5 flex flex-col divide-y divide-border-soft">
              {ROWS.map((row) => (
                <div key={row} className="grid gap-1 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-[13px] text-text-4">{t(`rowLabels.${row}`)}</dt>
                  <dd className="text-[14px] leading-snug text-text-2">{t(`${key}.rows.${row}`)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-auto pt-6">
              {key === "cloud" ? (
                <Link href="/login?mode=signup" className={`${CTA_BASE} bg-accent font-semibold text-[#06120d] hover:opacity-90`}>
                  {t("cloud.cta")}
                </Link>
              ) : (
                <a
                  href={SELF_HOSTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${CTA_BASE} border border-border-strong text-[#d4d4d4] hover:bg-white/[0.04]`}
                >
                  {t("selfHosted.cta")} <ArrowUpRight size={14} aria-hidden />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${CTA_BASE} border border-border-strong text-[#d4d4d4] hover:bg-white/[0.04]`}
          >
            <Star size={16} aria-hidden /> {t("star")}
          </a>
          <p className="mt-4 max-w-[420px] text-[13px] leading-relaxed text-text-4">{t("starHint")}</p>
        </div>

        <div className="min-w-0">
          <div className="overflow-hidden rounded-[8px] border border-border-strong bg-[#0a0a0a]">
            <div className="border-b border-border-soft px-4 py-2.5 font-mono text-[12px] text-text-4">{t("codeLabel")}</div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.8] text-text-2" aria-label={t("codeLabel")}>
              {COMMANDS.map((line) => (
                <span key={line} className="block whitespace-pre">
                  {!line.startsWith("  ") && <span aria-hidden className="select-none text-text-4">$ </span>}
                  {line}
                </span>
              ))}
            </pre>
          </div>
          <p className="mt-3 font-mono text-xs text-text-4">{t("requirements")}</p>
        </div>
      </div>
    </section>
  );
}
