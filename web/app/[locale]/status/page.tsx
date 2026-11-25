import { use } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { CorvoWordmark } from "@/components/ui/corvo-logo";
import { pageMetadata, seoLocale } from "@/lib/seo";

/**
 * Component names only. There is no monitoring source behind this page yet, so it shows
 * no uptime and no live state (fixed numbers looked measured and weren't).
 */
export const STATUS_SERVICES = ["API", "Webhooks", "Dashboard", "Authentication", "Embedded Signup"];

const incidents = [
  {
    date: "Aug 15, 2026",
    title: "Increased webhook latency",
    status: "resolved",
    duration: "12 min",
    description:
      "Some webhook deliveries experienced higher than normal latency between 14:32 and 14:44 UTC. No messages were lost.",
  },
  {
    date: "Jul 28, 2026",
    title: "API timeout on template creation",
    status: "resolved",
    duration: "8 min",
    description:
      "A deploy caused elevated error rates on POST /v1/templates. Rolled back and all systems recovered.",
  },
];

const STATUS_COPY = {
  pt: {
    title: "Status do serviço",
    description: "Veja o estado da API, dos webhooks e do painel da Corvo, e o histórico de incidentes já resolvidos.",
  },
  en: {
    title: "Service status",
    description: "See the state of the Corvo API, webhooks and dashboard, and the history of incidents that were already resolved.",
  },
} as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const copy = STATUS_COPY[seoLocale((await params).locale)];
  return pageMetadata({ locale: (await params).locale, path: "/status", ...copy });
}

export default function StatusPage({ params }: { params?: Promise<{ locale: string }> }) {
  const home = `/${seoLocale(params ? use(params).locale : "pt")}`;
  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      <nav className="border-b border-border-soft px-10 py-4 flex items-center justify-between">
        <Link href={home}>
          <CorvoWordmark size={16} variant="green" />
        </Link>
        <Link
          href={home}
          className="text-sm text-text-3 hover:text-text transition-colors"
        >
          Back to home
        </Link>
      </nav>

      <main className="max-w-[640px] mx-auto px-10 py-16">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] mb-1">
          Status
        </h1>
        <p className="text-[15px] text-text-3 mb-10">
          Corvo services and infrastructure components. This page does not show live metrics.
        </p>

        {/* Services */}
        <div className="border border-border rounded-xl bg-surface overflow-hidden mb-10">
          <div className="px-5 py-3.5 border-b border-border-soft">
            <span className="text-sm font-semibold">Services</span>
          </div>
          {STATUS_SERVICES.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between px-5 py-3.5 border-b border-[#151515] last:border-b-0"
            >
              <span className="text-[14.5px]">{name}</span>
            </div>
          ))}
        </div>

        {/* Incidents */}
        <h2 className="text-lg font-semibold mb-4">Past incidents</h2>
        <div className="flex flex-col gap-4">
          {incidents.map((incident) => (
            <div
              key={incident.title}
              className="border border-border rounded-xl bg-surface p-5"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[14.5px] font-medium">
                  {incident.title}
                </span>
                <span className="font-mono text-xs text-text-3">
                  {incident.duration}
                </span>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <span className="font-mono text-xs text-text-4">
                  {incident.date}
                </span>
                <span className="font-mono text-xs text-accent">
                  {incident.status}
                </span>
              </div>
              <p className="text-[13.5px] text-text-3 leading-relaxed">
                {incident.description}
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
