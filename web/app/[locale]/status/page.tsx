import Link from "next/link";
import { CorvoWordmark } from "@/components/ui/corvo-logo";

const services = [
  { name: "API", status: "operational", uptime: "99.98%" },
  { name: "Webhooks", status: "operational", uptime: "99.99%" },
  { name: "Dashboard", status: "operational", uptime: "99.97%" },
  { name: "Authentication", status: "operational", uptime: "100%" },
  { name: "Embedded Signup", status: "operational", uptime: "99.95%" },
];

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

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      <nav className="border-b border-border-soft px-10 py-4 flex items-center justify-between">
        <Link href="/">
          <CorvoWordmark size={16} variant="green" />
        </Link>
        <Link
          href="/"
          className="text-sm text-text-3 hover:text-text transition-colors"
        >
          Back to home
        </Link>
      </nav>

      <main className="max-w-[640px] mx-auto px-10 py-16">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-2.5 h-2.5 rounded-full bg-accent" />
          <span className="text-sm font-mono text-accent">All systems operational</span>
        </div>
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] mb-1">
          Status
        </h1>
        <p className="text-[15px] text-text-3 mb-10">
          Real-time status of Corvo services and infrastructure.
        </p>

        {/* Services */}
        <div className="border border-border rounded-xl bg-surface overflow-hidden mb-10">
          <div className="px-5 py-3.5 border-b border-border-soft">
            <span className="text-sm font-semibold">Services</span>
          </div>
          {services.map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between px-5 py-3.5 border-b border-[#151515] last:border-b-0"
            >
              <span className="text-[14.5px]">{service.name}</span>
              <div className="flex items-center gap-4">
                <span className="font-mono text-xs text-text-3">
                  {service.uptime} uptime
                </span>
                <span className="flex items-center gap-1.5 font-mono text-xs text-accent">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                  operational
                </span>
              </div>
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
