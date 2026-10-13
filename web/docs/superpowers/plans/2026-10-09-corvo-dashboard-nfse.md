# Corvo Dashboard NFS-e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WhatsApp-oriented dashboard with an NFS-e billing dashboard using the same visual structure, components, and patterns — new routes, new API namespaces, new pages, mock data first.

**Architecture:** The dashboard layout (sidebar + topbar) and all UI components are preserved. Only the data layer (API calls, types, i18n) and page content change. New pages live under `app/app/`. Legacy WhatsApp pages are removed. Mock data drives all pages initially.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind, motion/react, next-intl

**Spec:** This plan implements the NFS-e pivot from the Corvo API contract provided by the user.

---

## Global Constraints

- All API calls go through `lib/api.ts` namespace exports (never inline fetch)
- i18n strings live in `messages/pt.json` and `messages/en.json`
- Components use `useTranslations` from `next-intl`
- Dashboard layout: `app/app/layout.tsx` + `components/dashboard/sidebar.tsx`
- Mock data for all new pages (no real API integration yet)

---

## File Map

```
MODIFIED:
  lib/types.ts                   ← add NFS-e types (Company, Invoice, Certificate, BillingUsage)
  lib/api.ts                    ← add companies/invoices/billing namespaces
  lib/mock-data.ts               ← add NFS-e mock data
  messages/pt.json               ← add Dashboard/Overview/Companies/Invoices/Billing namespaces
  messages/en.json               ← add same namespaces (EN)
  components/dashboard/sidebar.tsx ← update navGroup1 to NFS-e routes
  app/app/layout.tsx             ← update pathToPage keys
  app/app/page.tsx              ← replace with NFS-e overview
  app/app/connections/         ← DELETE
  app/app/templates/             ← DELETE
  app/app/messages/            ← DELETE

CREATED:
  app/app/companies/page.tsx    ← Companies list + create
  app/app/invoices/page.tsx     ← Invoices list
  app/app/invoices/new/page.tsx  ← New invoice form
  app/app/billing/page.tsx      ← Plan + usage
  components/ui/nfse-status-badge.tsx ← Invoice status badge
  components/dashboard/invoice-table.tsx ← Shared invoice table
```

---

## Task 1: NFS-e Types

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `Company`, `Certificate`, `Invoice`, `InvoiceStatus`, `BillingUsage`, `PlanTier` types

- [ ] **Step 1: Add NFS-e types to lib/types.ts**

Add after the existing types (before line 425):

```typescript
// ── Company types ────────────────────────────────────────────────────────────

export type CompanyStatus = "pending_setup" | "ready" | "suspended";

export interface Company {
  id: string;
  tenantId: string;
  legalName: string;
  tradeName: string;
  taxId: string; // CNPJ
  municipalReg: string;
  municipalityCode: string;
  taxRegime: string;
  simpleNational: boolean;
  address: {
    street: string;
    number: string;
    city: string;
    state: string;
    zip: string;
  };
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCompanyInput {
  legalName: string;
  tradeName: string;
  taxId: string;
  municipalReg: string;
  municipalityCode: string;
  taxRegime: string;
  simpleNational: boolean;
  address: {
    street: string;
    number: string;
    city: string;
    state: string;
    zip: string;
  };
}

// ── Certificate types ────────────────────────────────────────────────────────

export type CertificateStatus = "active" | "expiring_soon" | "expired";

export interface Certificate {
  id: string;
  companyId: string;
  serialNumber: string;
  validFrom: string;
  validUntil: string;
  status: CertificateStatus;
  createdAt: string;
}

// ── Invoice types ─────────────────────────────────────────────────────────────

export type InvoiceStatus = "queued" | "processing" | "authorized" | "rejected" | "reconciliation_required";

export interface Invoice {
  id: string;
  tenantId: string;
  companyId: string;
  externalId?: string;
  accessKey?: string;
  nfseNumber?: string;
  status: InvoiceStatus;
  amount: number;
  customerName: string;
  customerTaxId: string;
  serviceDescription: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  authorizedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvoiceInput {
  companyId: string;
  externalId?: string;
  customer: {
    taxId: string;
    name: string;
    email: string;
    address: { city: string; state: string };
  };
  service: {
    description: string;
    code: string;
    municipalityCode: string;
  };
  amount: number;
  competenceDate: string;
}

export interface InvoiceEvent {
  from: string;
  to: string;
  at: string;
  reason?: string;
}

// ── Billing types ─────────────────────────────────────────────────────────────

export interface BillingUsage {
  creditsUsed: number;
  creditsReserved: number;
  creditsRemaining: number;
  monthlyAllowance: number;
  dailyUsage: number;
  dailyLimit: number | null;
  activeCompanies: number;
  maxActiveCompanies: number;
  periodStart: string;
  periodEnd: string;
}

export interface BillingPlan {
  slug: string;
  name: string;
  monthlyPriceCents: number;
  usage: BillingUsage;
}

export interface PlanTier {
  slug: string;
  name: string;
  monthlyAllowance: number;
  dailyLimit: number | null;
  maxActiveCompanies: number;
  basePriceCents: number;
  perCreditCents: number;
  includesWebhooks: boolean;
  includesXmlDownload: boolean;
  includesPdfDownload: boolean;
  supportTier: string;
  active: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat(dashboard): add NFS-e types (Company, Invoice, Certificate, Billing)"
```

---

## Task 2: API Layer — companies, invoices, billing namespaces

**Files:**
- Modify: `lib/api.ts`

**Interfaces:**
- Consumes: types from Task 1
- Produces: `companies`, `invoices`, `billing` namespaces exported from api.ts

- [ ] **Step 1: Add new namespaces to lib/api.ts**

Add after the existing `plans` export (around line 230):

```typescript
// ── Companies ────────────────────────────────────────────────────────────────

export const companies = {
  list: () => request<Company[]>("/v1/companies"),

  get: (id: string) => request<Company>(`/v1/companies/${id}`),

  create: (data: CreateCompanyInput) =>
    request<Company>("/v1/companies", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<CreateCompanyInput>) =>
    request<Company>(`/v1/companies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ deleted: boolean }>(`/v1/companies/${id}`, {
      method: "DELETE",
    }),
};

// ── Certificates ───────────────────────────────────────────────────────────

export const certificates = {
  list: (companyId: string) =>
    request<Certificate[]>(`/v1/companies/${companyId}/certificates`),

  create: (
    companyId: string,
    formData: FormData
  ) =>
    request<Certificate>(`/v1/companies/${companyId}/certificates`, {
      method: "POST",
      body: formData,
      // Note: don't set Content-Type header — browser sets it with boundary
    }),

  delete: (companyId: string, certId: string) =>
    request<{ deleted: boolean }>(
      `/v1/companies/${companyId}/certificates/${certId}`,
      { method: "DELETE" }
    ),
};

// ── Invoices ───────────────────────────────────────────────────────────────

export const invoices = {
  list: (params?: {
    limit?: number;
    cursor?: string;
    companyId?: string;
    status?: InvoiceStatus;
    from?: string;
    to?: string;
    externalId?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.cursor) qs.set("cursor", params.cursor);
    if (params?.companyId) qs.set("companyId", params.companyId);
    if (params?.status) qs.set("status", params.status);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.externalId) qs.set("externalId", params.externalId);
    const q = qs.toString();
    return request<{ data: Invoice[]; next_cursor: string | null }>(
      `/v1/invoices${q ? `?${q}` : ""}`
    );
  },

  get: (id: string) => request<Invoice>(`/v1/invoices/${id}`),

  create: (data: CreateInvoiceInput) =>
    request<{ data: { id: string; status: string } }>("/v1/invoices", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  xml: (id: string) =>
    fetch(`${BASE}/v1/invoices/${id}/xml`, { credentials: "include" })
      .then((r) => r.blob()),

  pdf: (id: string) =>
    fetch(`${BASE}/v1/invoices/${id}/pdf`, { credentials: "include" })
      .then((r) => r.blob()),

  events: (id: string) =>
    request<InvoiceEvent[]>(`/v1/invoices/${id}/events`),
};

// ── Billing ───────────────────────────────────────────────────────────────

export const billing = {
  plan: () => request<BillingPlan>("/v1/billing/plan"),

  upgrade: (planSlug: string) =>
    request<{ planSlug: string }>("/v1/billing/upgrade", {
      method: "POST",
      body: JSON.stringify({ planSlug }),
    }),

  downgrade: (planSlug: string) =>
    request<{ currentPlan: string; scheduledPlan: string; effectiveAt: string }>(
      "/v1/billing/downgrade",
      { method: "POST", body: JSON.stringify({ planSlug }) }
    ),

  plans: () => request<PlanTier[]>("/v1/plans"),

  quote: (volume: number) =>
    request<{
      recommendedPlan: string;
      monthlyAllowance: number;
      overageCredits: number;
      overageCostCents: number;
      basePriceCents: number;
      totalEstimatedCents: number;
    }>(`/v1/plans/quote?volume=${volume}`),
};
```

- [ ] **Step 2: Export the new types from lib/api.ts**

Add to the existing `export type` block in `lib/api.ts`:

```typescript
export type {
  // add after existing exports:
  Company,
  Certificate,
  Invoice,
  InvoiceStatus,
  InvoiceEvent,
  BillingPlan,
  BillingUsage,
  CreateCompanyInput,
  CreateInvoiceInput,
  PlanTier,
} from "./types";
```

- [ ] **Step 3: Commit**

```bash
git add lib/api.ts lib/types.ts
git commit -m "feat(dashboard): add companies, invoices, billing API namespaces"
```

---

## Task 3: Mock data for NFS-e

**Files:**
- Modify: `lib/mock-data.ts`

**Interfaces:**
- Consumes: types from Task 1
- Produces: realistic mock data for companies, invoices, billing

- [ ] **Step 1: Add NFS-e mock data to lib/mock-data.ts**

Add after existing mock data (at end of file):

```typescript
// ── Companies ────────────────────────────────────────────────────────────────

export const MOCK_COMPANIES: Company[] = [
  {
    id: "comp_001",
    tenantId: "tenant_001",
    legalName: "Acme Desenvolvimento de Software LTDA",
    tradeName: "Acme",
    taxId: "12345678000199",
    municipalReg: "12345",
    municipalityCode: "3550308",
    taxRegime: "Lucro Presumido",
    simpleNational: false,
    address: {
      street: "Rua Augusta",
      number: "1500",
      city: "São Paulo",
      state: "SP",
      zip: "01310100",
    },
    status: "ready",
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-09-15T14:30:00Z",
  },
  {
    id: "comp_002",
    tenantId: "tenant_001",
    legalName: "TechStart Consultoria LTDA",
    tradeName: "TechStart",
    taxId: "98765432000188",
    municipalReg: "54321",
    municipalityCode: "3304557",
    taxRegime: "Simples Nacional",
    simpleNational: true,
    address: {
      street: "Av. Presidente Vargas",
      number: "800",
      city: "Rio de Janeiro",
      state: "RJ",
      zip: "20071004",
    },
    status: "pending_setup",
    createdAt: "2026-09-20T09:00:00Z",
    updatedAt: "2026-09-20T09:00:00Z",
  },
];

// ── Invoices ───────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export const MOCK_INVOICES: Invoice[] = [
  {
    id: "inv_001",
    tenantId: "tenant_001",
    companyId: "comp_001",
    externalId: "pedido-1001",
    accessKey: "NFSe35503080612345678000199450001000000123450001",
    nfseNumber: "12345",
    status: "authorized",
    amount: 1990.00,
    customerName: "Beta Soluções em TI LTDA",
    customerTaxId: "11222333000181",
    serviceDescription: "Desenvolvimento de software sob demanda",
    authorizedAt: daysAgo(2),
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
  },
  {
    id: "inv_002",
    tenantId: "tenant_001",
    companyId: "comp_001",
    externalId: "pedido-1002",
    status: "processing",
    amount: 4500.00,
    customerName: "Gamma Atacado EIRELI",
    customerTaxId: "44555666000177",
    serviceDescription: "Consultoria em arquitetura de sistemas",
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
  },
  {
    id: "inv_003",
    tenantId: "tenant_001",
    companyId: "comp_001",
    externalId: "pedido-0999",
    accessKey: "NFSe35503080612345678000199450001000000123449999",
    nfseNumber: "12344",
    status: "authorized",
    amount: 890.00,
    customerName: "Delta Marketing Digital ME",
    customerTaxId: "77888999000166",
    serviceDescription: "Manutenção de infraestrutura cloud",
    authorizedAt: daysAgo(5),
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
  },
  {
    id: "inv_004",
    tenantId: "tenant_001",
    companyId: "comp_001",
    externalId: "pedido-0998",
    status: "rejected",
    amount: 2500.00,
    customerName: "Epsilon Logística S.A.",
    customerTaxId: "99000011000155",
    serviceDescription: "Integração de API REST",
    lastErrorCode: "INVALID_TAX_ID",
    lastErrorMessage: "CNPJ do tomador inválido ou inativo na Receita Federal",
    createdAt: daysAgo(7),
    updatedAt: daysAgo(7),
  },
  {
    id: "inv_005",
    tenantId: "tenant_001",
    companyId: "comp_001",
    status: "authorized",
    amount: 1200.00,
    customerName: "Zeta Alimentos LTDA",
    customerTaxId: "11002233000144",
    serviceDescription: "Suporte técnico especializado",
    authorizedAt: daysAgo(12),
    createdAt: daysAgo(12),
    updatedAt: daysAgo(12),
  },
];

// ── Billing ───────────────────────────────────────────────────────────────

export const MOCK_BILLING: BillingPlan = {
  slug: "developer",
  name: "Developer",
  monthlyPriceCents: 2990,
  usage: {
    creditsUsed: 87,
    creditsReserved: 3,
    creditsRemaining: 113,
    monthlyAllowance: 200,
    dailyUsage: 5,
    dailyLimit: null,
    activeCompanies: 1,
    maxActiveCompanies: 10,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
  },
};
```

- [ ] **Step 2: Export mock data from lib/mock-data.ts**

Ensure the file exports these at the bottom. If they aren't exported, add:

```typescript
export { MOCK_COMPANIES, MOCK_INVOICES, MOCK_BILLING };
```

- [ ] **Step 3: Commit**

```bash
git add lib/mock-data.ts
git commit -m "feat(dashboard): add NFS-e mock data (companies, invoices, billing)"
```

---

## Task 4: NFS-e Overview page

**Files:**
- Modify: `app/app/page.tsx`
- Create: `components/dashboard/invoice-table.tsx`

**Interfaces:**
- Consumes: `MOCK_INVOICES`, `MOCK_BILLING`, types from Task 1
- Produces: new `app/app/page.tsx` — overview with KPIs, invoice heatmap, recent invoices table

- [ ] **Step 1: Create shared invoice table component**

Create `components/dashboard/invoice-table.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Invoice } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { TableHeader, TableRow } from "@/components/ui/table";
import { timeAgo } from "@/lib/i18n-helpers";

const statusVariant: Record<string, "accent" | "info" | "danger" | "gray"> = {
  authorized: "accent",
  processing: "info",
  queued: "gray",
  rejected: "danger",
  reconciliation_required: "danger",
};

const statusLabel: Record<string, string> = {
  authorized: "Autorizada",
  processing: "Processando",
  queued: "Na fila",
  rejected: "Rejeitada",
  reconciliation_required: "Reconciliação",
};

interface InvoiceTableProps {
  invoices: Invoice[];
  emptyText: string;
  showCompany?: boolean;
  maxRows?: number;
  timeAgoT: ReturnType<typeof useTranslations>;
}

export function InvoiceTable({
  invoices,
  emptyText,
  showCompany = false,
  maxRows,
  timeAgoT,
}: InvoiceTableProps) {
  const rows = maxRows ? invoices.slice(0, maxRows) : invoices;

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-[13px] text-text-4">
        {emptyText}
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-t border-border">
          <TableHeader className="pl-5">ID</TableHeader>
          {showCompany && <TableHeader>Empresa</TableHeader>}
          <TableHeader>Cliente</TableHeader>
          <TableHeader>Valor</TableHeader>
          <TableHeader>Status</TableHeader>
          <TableHeader className="pr-5">Criada</TableHeader>
        </tr>
      </thead>
      <tbody>
        {rows.map((inv) => (
          <TableRow key={inv.id}>
            <td className="pl-5 font-mono text-[12px] text-text-3">
              {inv.id.slice(0, 12)}...
            </td>
            {showCompany && <td className="text-[13px]">{inv.companyId.slice(0, 8)}...</td>}
            <td className="text-[13px] text-text-2">{inv.customerName}</td>
            <td className="text-[13px] font-medium">
              R$ {inv.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </td>
            <td>
              <Badge variant={statusVariant[inv.status] ?? "gray"}>
                {statusLabel[inv.status] ?? inv.status}
              </Badge>
            </td>
            <td className="pr-5 text-[13px] text-text-3">
              {timeAgo(inv.createdAt, timeAgoT)}
            </td>
          </TableRow>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Rewrite app/app/page.tsx**

Replace the entire file content with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import type { Invoice, BillingPlan } from "@/lib/types";
import { MOCK_INVOICES, MOCK_BILLING } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InvoiceTable } from "@/components/dashboard/invoice-table";

type HeatmapCell = { date: Date; count: number; inRange: boolean };

function buildHeatmapGrid(invoices: Invoice[], days: number): HeatmapCell[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - days + 1);
  const dayOfWeek = (startDate.getDay() + 6) % 7;
  startDate.setDate(startDate.getDate() - dayOfWeek);

  const buckets = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status !== "authorized") continue;
    const d = new Date(inv.createdAt);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const rangeStart = new Date(today);
  rangeStart.setDate(today.getDate() - days + 1);
  const totalDays = days + dayOfWeek;
  const weeksCount = Math.ceil(totalDays / 7);

  const grid: HeatmapCell[][] = [];
  for (let w = 0; w < weeksCount; w++) {
    const col: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + w * 7 + d);
      const key = cellDate.toISOString().slice(0, 10);
      col.push({ date: cellDate, count: buckets.get(key) ?? 0, inRange: cellDate >= rangeStart && cellDate <= today });
    }
    grid.push(col);
  }
  return grid;
}

function getIntensity(count: number, max: number): number {
  if (count === 0 || max === 0) return 0;
  const ratio = count / max;
  if (ratio >= 0.8) return 0.95;
  if (ratio >= 0.6) return 0.75;
  if (ratio >= 0.4) return 0.55;
  if (ratio >= 0.2) return 0.35;
  return 0.15;
}

const INTENSITY_STOPS = [0.15, 0.35, 0.55, 0.75, 0.95];

function InvoiceHeatmap({ invoices, days, locale }: { invoices: Invoice[]; days: number; locale: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; date: Date; count: number } | null>(null);
  const grid = buildHeatmapGrid(invoices, days);
  const max = Math.max(1, ...grid.flat().filter((c) => c.inRange).map((c) => c.count));
  const dayLabelFormatter = new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", { weekday: "short" });
  const dateFormatter = new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", { weekday: "short", month: "short", day: "numeric" });
  const dayLabels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1);
    d.setDate(d.getDate() + i);
    return dayLabelFormatter.format(d).slice(0, 3);
  });
  const visibleDays = [0, 2, 4];
  const hasData = grid.some((col) => col.some((c) => c.inRange && c.count > 0));

  if (!hasData) return <div className="h-full flex items-center justify-center text-text-4 text-[13px]">Sem dados para este período</div>;

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="flex flex-col gap-[3px]">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="h-[12px] text-[10px] text-text-4 font-mono leading-[12px] flex items-center">
              {visibleDays.includes(i) ? dayLabels[i] : ""}
            </div>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {grid.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map((cell, ri) => (
                <div
                  key={ri}
                  onMouseEnter={(e) => { if (cell.inRange) setTip({ x: e.clientX, y: e.clientY, date: cell.date, count: cell.count }); }}
                  onMouseMove={(e) => { if (cell.inRange) setTip({ x: e.clientX, y: e.clientY, date: cell.date, count: cell.count }); }}
                  onMouseLeave={() => setTip(null)}
                  className={`w-[12px] h-[12px] rounded-[2px] transition-all duration-150 ${cell.inRange ? "cursor-pointer hover:scale-110" : "opacity-25"}`}
                  style={{
                    backgroundColor: cell.count > 0 ? `oklch(0.82 0.14 165 / ${getIntensity(cell.count, max)})` : "#0d0d0d",
                    border: cell.count > 0 ? "none" : "1px solid #1a1a1a",
                    boxShadow: cell.count > 0 ? `0 0 8px oklch(0.82 0.14 165 / ${getIntensity(cell.count, max) * 0.5})` : "none",
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4 text-[11px] text-text-4 font-mono">
        <span>Menos</span>
        <div className="flex gap-[3px]">
          {INTENSITY_STOPS.map((a, i) => (
            <div key={i} className="w-[12px] h-[12px] rounded-[2px]" style={{ backgroundColor: `oklch(0.82 0.14 165 / ${a})` }} />
          ))}
        </div>
        <span>Mais</span>
      </div>
      {tip && (
        <div
          className="fixed z-50 pointer-events-none bg-[#161616] border border-[#2b2b2b] rounded-md px-2.5 py-1.5 shadow-xl"
          style={{ left: tip.x + 12, top: tip.y + 12, fontFamily: "var(--font-jetbrains-mono), monospace" }}
        >
          <div className="text-[11px] text-text font-medium leading-tight">
            {dateFormatter.format(tip.date)}
          </div>
          <div className="text-[10.5px] text-text-3 mt-1 leading-tight">
            <span className="text-accent">{tip.count}</span> nota{tip.count !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OverviewPage() {
  const t = useTranslations("Overview");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [invoices] = useState<Invoice[]>(MOCK_INVOICES);
  const [billing] = useState<BillingPlan>(MOCK_BILLING);
  const [period, setPeriod] = useState<"7d" | "30d">("30d");

  const u = billing.usage;
  const authorized = invoices.filter((i) => i.status === "authorized");
  const rejected = invoices.filter((i) => i.status === "rejected");
  const processing = invoices.filter((i) => i.status === "processing" || i.status === "queued");

  const kpis = [
    { label: "AUTORIZADAS", value: authorized.length, variant: "accent" as const },
    { label: "REJEITADAS", value: rejected.length, variant: "danger" as const },
    { label: "PROCESSANDO", value: processing.length, variant: "info" as const },
    { label: "CRÉDITOS", value: `${u.creditsUsed}/${u.monthlyAllowance}`, variant: "text-3" as const },
  ];

  return (
    <div className="p-8 flex flex-col gap-6.5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-[14.5px] text-text-3 mt-1">
            {period === "7d" ? t("last7days") : t("last30days")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center border border-border rounded-[8px] overflow-hidden">
            <button onClick={() => setPeriod("7d")} className={`px-3.5 py-1.5 text-[13px] transition-colors ${period === "7d" ? "bg-[#1a1a1a] text-text" : "text-text-3 hover:text-text-2"}`}>
              {t("days7")}
            </button>
            <button onClick={() => setPeriod("30d")} className={`px-3.5 py-1.5 text-[13px] transition-colors ${period === "30d" ? "bg-[#1a1a1a] text-text" : "text-text-3 hover:text-text-2"}`}>
              {t("days30")}
            </button>
          </div>
          <Link
            href="/app/invoices/new"
            className="bg-[#ededec] text-[#0a0a0a] rounded-[8px] px-4 py-1.5 text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            + Nova nota
          </Link>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-border rounded-[11px] bg-surface overflow-hidden">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="p-5 flex flex-col gap-1.5 border-r border-border last:border-r-0">
            <span className="font-mono text-[11px] text-text-3 tracking-wide">{kpi.label}</span>
            <span className="text-[27px] font-semibold tracking-tight leading-none">{kpi.value}</span>
          </div>
        ))}
      </div>

      {/* Invoice heatmap */}
      <Card className="p-5.5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-medium">Notas por dia</h2>
          <span className="text-[12px] text-text-4 font-mono">
            {period === "7d" ? t("days7") : t("days30")}
          </span>
        </div>
        <div className="min-h-[140px]">
          <InvoiceHeatmap invoices={invoices} days={period === "7d" ? 7 : 30} locale={locale} />
        </div>
      </Card>

      {/* Recent invoices */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[15px] font-medium">Notas recentes</h2>
          <Link href="/app/invoices" className="text-[13px] text-text-3 hover:text-text transition-colors">
            Ver todas
          </Link>
        </div>
        <InvoiceTable invoices={invoices} emptyText={t("noData")} timeAgoT={tc} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/app/page.tsx components/dashboard/invoice-table.tsx
git commit -m "feat(dashboard): rewrite overview page for NFS-e with KPIs and invoice heatmap"
```

---

## Task 5: Companies page

**Files:**
- Create: `app/app/companies/page.tsx`

**Interfaces:**
- Consumes: `MOCK_COMPANIES`, types from Task 1
- Produces: `app/app/companies/page.tsx` with list + create form

- [ ] **Step 1: Create app/app/companies/page.tsx**

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MOCK_COMPANIES } from "@/lib/mock-data";
import type { Company } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";

const statusVariant: Record<string, "accent" | "info" | "danger"> = {
  ready: "accent",
  pending_setup: "info",
  suspended: "danger",
};

const statusLabel: Record<string, string> = {
  ready: "Pronto",
  pending_setup: "Configuração pendente",
  suspended: "Suspenso",
};

export default function CompaniesPage() {
  const t = useTranslations("Companies");
  const tc = useTranslations("Common");
  const { toast } = useToast();
  const [companies] = useState<Company[]>(MOCK_COMPANIES);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="p-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-[14.5px] text-text-3 mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-[#ededec] text-[#0a0a0a] rounded-[8px] px-4 py-2 text-[14px] font-medium hover:opacity-90 transition-opacity"
        >
          + {t("add")}
        </button>
      </div>

      {/* Create form (collapsed for now — full form in Task 6) */}
      {showForm && (
        <Card className="p-5 border-accent/40">
          <p className="text-[13px] text-text-3">
            {t("createHint")}
          </p>
          <button
            onClick={() => setShowForm(false)}
            className="mt-3 text-[13px] text-text-3 hover:text-text transition-colors"
          >
            {tc("cancel")}
          </button>
        </Card>
      )}

      {/* Companies list */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[15px] font-medium">{t("title")}</h2>
          <span className="font-mono text-[12px] text-text-4">{companies.length} empresa{companies.length !== 1 ? "s" : ""}</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-t border-border">
              <TableHeader className="pl-5">Nome</TableHeader>
              <TableHeader>CNPJ</TableHeader>
              <TableHeader>Município</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader className="pr-5">Criada</TableHeader>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <TableRow key={company.id}>
                <td className="pl-5">
                  <div className="text-[14px] font-medium">{company.tradeName}</div>
                  <div className="text-[12px] text-text-3">{company.legalName}</div>
                </td>
                <td className="font-mono text-[13px] text-text-2">
                  {company.taxId.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}
                </td>
                <td className="text-[13px] text-text-2">{company.address.city}, {company.address.state}</td>
                <td>
                  <Badge variant={statusVariant[company.status] ?? "gray"}>
                    {statusLabel[company.status] ?? company.status}
                  </Badge>
                </td>
                <td className="pr-5 text-[13px] text-text-3">
                  {new Date(company.createdAt).toLocaleDateString("pt-BR")}
                </td>
              </TableRow>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add Companies i18n keys to messages/pt.json and messages/en.json**

In `messages/pt.json`, add after the Overview section:

```json
"Companies": {
  "title": "Empresas",
  "subtitle": "Gerencie as empresas emissoras de NFS-e.",
  "add": "Nova empresa",
  "createHint": "Formulário de criação de empresa em breve. A integração com o backend virá em breve.",
  "table": {
    "name": "NOME",
    "taxId": "CNPJ",
    "city": "CIDADE",
    "status": "STATUS",
    "created": "CRIADA"
  }
},
```

In `messages/en.json`, same structure with English text.

- [ ] **Step 3: Commit**

```bash
git add app/app/companies/page.tsx messages/pt.json messages/en.json
git commit -m "feat(dashboard): add companies page with list view"
```

---

## Task 6: Invoices list page

**Files:**
- Create: `app/app/invoices/page.tsx`

**Interfaces:**
- Consumes: `MOCK_INVOICES`, types from Task 1
- Produces: `app/app/invoices/page.tsx` with filterable invoice table

- [ ] **Step 1: Create app/app/invoices/page.tsx**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { MOCK_INVOICES } from "@/lib/mock-data";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { InvoiceTable } from "@/components/dashboard/invoice-table";

const STATUS_FILTERS: { value: InvoiceStatus | "all"; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "authorized", label: "Autorizadas" },
  { value: "processing", label: "Processando" },
  { value: "rejected", label: "Rejeitadas" },
];

export default function InvoicesPage() {
  const t = useTranslations("Invoices");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [invoices] = useState<Invoice[]>(MOCK_INVOICES);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");

  const filtered = statusFilter === "all"
    ? invoices
    : invoices.filter((i) => i.status === statusFilter);

  return (
    <div className="p-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-[14.5px] text-text-3 mt-1">{t("subtitle")}</p>
        </div>
        <Link
          href="/app/invoices/new"
          className="bg-[#ededec] text-[#0a0a0a] rounded-[8px] px-4 py-2 text-[14px] font-medium hover:opacity-90 transition-opacity"
        >
          + {t("new")}
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`px-3.5 py-1.5 text-[13px] rounded-full border transition-colors ${
              statusFilter === f.value
                ? "bg-[#1a1a1a] text-text border-border"
                : "text-text-3 border-transparent hover:text-text-2"
            }`}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1.5 font-mono text-[11px] opacity-60">
                ({invoices.filter((i) => i.status === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="border border-border rounded-[11px] overflow-hidden">
        <InvoiceTable invoices={filtered} emptyText={t("noInvoices")} showCompany timeAgoT={tc} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Invoices i18n keys to messages/pt.json and messages/en.json**

In `messages/pt.json`, add:

```json
"Invoices": {
  "title": "Notas fiscais",
  "subtitle": "Histórico de notasEmitidas, processadas e rejeitadas.",
  "new": "Nova nota",
  "noInvoices": "Nenhuma nota encontrada.",
  "table": {
    "id": "ID",
    "company": "EMPRESA",
    "customer": "CLIENTE",
    "amount": "VALOR",
    "status": "STATUS",
    "created": "CRIADA"
  }
},
```

In `messages/en.json`, same structure with English text.

- [ ] **Step 3: Commit**

```bash
git add app/app/invoices/page.tsx messages/pt.json messages/en.json
git commit -m "feat(dashboard): add invoices list page with filters"
```

---

## Task 7: New Invoice form page

**Files:**
- Create: `app/app/invoices/new/page.tsx`

**Interfaces:**
- Consumes: `MOCK_COMPANIES`, `companies.create()` from Task 2
- Produces: `app/app/invoices/new/page.tsx` with form

- [ ] **Step 1: Create app/app/invoices/new/page.tsx`

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MOCK_COMPANIES } from "@/lib/mock-data";
import { Card } from "@/components/ui/card";

export default function NewInvoicePage() {
  const t = useTranslations("Invoices");
  const router = useRouter();
  const [form, setForm] = useState({
    companyId: MOCK_COMPANIES[0].id,
    externalId: "",
    customerTaxId: "",
    customerName: "",
    customerEmail: "",
    city: "",
    state: "",
    serviceDescription: "",
    serviceCode: "010101",
    municipalityCode: "3550308",
    amount: "",
    competenceDate: new Date().toISOString().slice(0, 10),
  });
  const [submitting, setSubmitting] = useState(false);

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // TODO: call invoices.create() when API is ready
    await new Promise((r) => setTimeout(r, 800));
    setSubmitting(false);
    router.push("/app/invoices");
  }

  return (
    <div className="p-8 max-w-[640px] flex flex-col gap-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{t("newTitle")}</h1>
        <p className="text-[14.5px] text-text-3 mt-1">{t("newSubtitle")}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Card className="p-5 flex flex-col gap-4">
          <h2 className="text-[14px] font-medium text-text">{t("form.company")}</h2>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-text-3 font-mono">EMPRESA EMISSORA</span>
            <select
              value={form.companyId}
              onChange={(e) => set("companyId", e.target.value)}
              className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text outline-none focus:border-accent"
            >
              {MOCK_COMPANIES.map((c) => (
                <option key={c.id} value={c.id}>{c.tradeName}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-text-3 font-mono">SUA REFERÊNCIA (opcional)</span>
            <input
              type="text"
              value={form.externalId}
              onChange={(e) => set("externalId", e.target.value)}
              placeholder="pedido-12345"
              className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text placeholder:text-text-4 outline-none focus:border-accent"
            />
          </label>
        </Card>

        <Card className="p-5 flex flex-col gap-4">
          <h2 className="text-[14px] font-medium text-text">{t("form.customer")}</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-3 font-mono">CNPJ DO TOMADOR</span>
              <input
                type="text"
                value={form.customerTaxId}
                onChange={(e) => set("customerTaxId", e.target.value)}
                placeholder="11222333000181"
                className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text placeholder:text-text-4 outline-none focus:border-accent"
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-3 font-mono">NOME / RAZÃO SOCIAL</span>
              <input
                type="text"
                value={form.customerName}
                onChange={(e) => set("customerName", e.target.value)}
                placeholder="Empresa Cliente LTDA"
                className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text placeholder:text-text-4 outline-none focus:border-accent"
                required
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-text-3 font-mono">E-MAIL DO FINANCEIRO</span>
            <input
              type="email"
              value={form.customerEmail}
              onChange={(e) => set("customerEmail", e.target.value)}
              placeholder="fiscal@cliente.com"
              className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text placeholder:text-text-4 outline-none focus:border-accent"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-3 font-mono">CIDADE</span>
              <input
                type="text"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="São Paulo"
                className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text placeholder:text-text-4 outline-none focus:border-accent"
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-3 font-mono">ESTADO</span>
              <input
                type="text"
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
                placeholder="SP"
                maxLength={2}
                className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text placeholder:text-text-4 outline-none focus:border-accent uppercase"
                required
              />
            </label>
          </div>
        </Card>

        <Card className="p-5 flex flex-col gap-4">
          <h2 className="text-[14px] font-medium text-text">{t("form.service")}</h2>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-text-3 font-mono">DESCRIÇÃO DO SERVIÇO</span>
            <textarea
              value={form.serviceDescription}
              onChange={(e) => set("serviceDescription", e.target.value)}
              placeholder="Consultoria técnica em desenvolvimento de software"
              rows={3}
              className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text placeholder:text-text-4 outline-none focus:border-accent resize-none"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-3 font-mono">CÓDIGO DE TRIBUTAÇÃO</span>
              <input
                type="text"
                value={form.serviceCode}
                onChange={(e) => set("serviceCode", e.target.value)}
                className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-text-3 font-mono">DATA DE COMPETÊNCIA</span>
              <input
                type="date"
                value={form.competenceDate}
                onChange={(e) => set("competenceDate", e.target.value)}
                className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text outline-none focus:border-accent"
                required
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-text-3 font-mono">VALOR TOTAL (R$)</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="1000.00"
              className="bg-bg border border-border rounded-[7px] px-3 py-2 text-[14px] text-text placeholder:text-text-4 outline-none focus:border-accent"
              required
            />
          </label>
        </Card>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="bg-[#ededec] text-[#0a0a0a] rounded-[8px] px-6 py-2.5 text-[14px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-[14px] text-text-3 hover:text-text transition-colors"
          >
            {t("cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Add Invoices.new i18n keys to messages/pt.json and messages/en.json**

In `messages/pt.json`, update the Invoices section:

```json
"Invoices": {
  "title": "Notas fiscais",
  "subtitle": "Histórico de notasEmitidas, processadas e rejeitadas.",
  "new": "Nova nota",
  "newTitle": "Emitir nota fiscal",
  "newSubtitle": "Preencha os dados para emitir uma NFS-e.",
  "noInvoices": "Nenhuma nota encontrada.",
  "submit": "Emitir NFS-e",
  "submitting": "Emitindo...",
  "cancel": "Cancelar",
  "form": {
    "company": "Empresa emissora",
    "customer": "Dados do tomador",
    "service": "Serviço prestado"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/app/invoices/new/page.tsx messages/pt.json messages/en.json
git commit -m "feat(dashboard): add new invoice form page"
```

---

## Task 8: Billing page

**Files:**
- Create: `app/app/billing/page.tsx`

**Interfaces:**
- Consumes: `MOCK_BILLING`, types from Task 1
- Produces: `app/app/billing/page.tsx` with plan + usage display

- [ ] **Step 1: Create app/app/billing/page.tsx**

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MOCK_BILLING } from "@/lib/mock-data";
import type { BillingPlan } from "@/lib/types";
import { Card } from "@/components/ui/card";

export default function BillingPage() {
  const t = useTranslations("Billing");
  const [billing] = useState<BillingPlan>(MOCK_BILLING);
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");

  const u = billing.usage;
  const pct = (u.creditsUsed / u.monthlyAllowance) * 100;
  const annualPrice = Math.round(billing.monthlyPriceCents * 12 * 0.7);
  const annualMonthly = Math.round(annualPrice / 12);
  const displayPrice = cycle === "annual" ? annualMonthly : billing.monthlyPriceCents;

  return (
    <div className="p-8 flex flex-col gap-6 max-w-[640px]">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-[14.5px] text-text-3 mt-1">{t("subtitle")}</p>
      </div>

      {/* Plan card */}
      <Card className="p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-mono text-[11px] text-text-4 tracking-[0.1em] uppercase">{billing.name}</span>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-[36px] font-semibold tracking-[-0.04em]">
                R$ {(displayPrice / 100).toFixed(2).replace(".", ",")}
              </span>
              <span className="text-[14px] text-text-3 mb-1">
                {cycle === "annual" ? "/mês (anual)" : "/mês"}
              </span>
            </div>
            {cycle === "annual" && (
              <p className="text-[12px] text-text-3 mt-0.5">
                Cobrado anualmente — R$ {(annualPrice / 100).toFixed(2).replace(".", ",")} / ano
              </p>
            )}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setCycle("monthly")}
              className={`px-3 py-1 text-[12px] rounded-full border transition-colors ${
                cycle === "monthly" ? "bg-[#1a1a1a] text-text border-border" : "text-text-3 border-transparent"
              }`}
            >
              Mensal
            </button>
            <button
              onClick={() => setCycle("annual")}
              className={`px-3 py-1 text-[12px] rounded-full border transition-colors ${
                cycle === "annual" ? "bg-[#1a1a1a] text-text border-border" : "text-text-3 border-transparent"
              }`}
            >
              Anual <span className="text-accent">30% OFF</span>
            </button>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-[12px] text-text-3 mb-1.5">
            <span>Uso de notas</span>
            <span className="font-mono">{u.creditsUsed} / {u.monthlyAllowance}</span>
          </div>
          <div className="h-2.5 bg-[#1f1f1f] rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          {pct > 80 && (
            <p className="text-[11px] text-danger mt-1.5">
              ⚠ Você está usando mais de 80% da sua cota mensal.
            </p>
          )}
        </div>
      </Card>

      {/* Usage details */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5 flex flex-col gap-3">
          <span className="font-mono text-[11px] text-text-4 tracking-[0.1em]">PERÍODO</span>
          <div className="text-[14px] text-text">
            {new Date(u.periodStart).toLocaleDateString("pt-BR")} — {new Date(u.periodEnd).toLocaleDateString("pt-BR")}
          </div>
        </Card>
        <Card className="p-5 flex flex-col gap-3">
          <span className="font-mono text-[11px] text-text-4 tracking-[0.1em]">EMPRESAS ATIVAS</span>
          <div className="text-[14px] text-text">
            {u.activeCompanies} / {u.maxActiveCompanies === 999999 ? "∞" : u.maxActiveCompanies}
          </div>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Billing i18n keys to messages/pt.json and messages/en.json**

In `messages/pt.json`:

```json
"Billing": {
  "title": "Plano e uso",
  "subtitle": "Acompanhe sua cota de notas e informações do plano."
},
```

In `messages/en.json`, same structure with English text.

- [ ] **Step 3: Commit**

```bash
git add app/app/billing/page.tsx messages/pt.json messages/en.json
git commit -m "feat(dashboard): add billing page with plan and usage"
```

---

## Task 9: Sidebar + Layout update

**Files:**
- Modify: `components/dashboard/sidebar.tsx`, `app/app/layout.tsx`

**Interfaces:**
- Consumes: updated route paths
- Produces: sidebar with NFS-e nav, updated pathToPage

- [ ] **Step 1: Update sidebar.tsx navGroup1**

Replace `navGroup1` in `components/dashboard/sidebar.tsx`:

```tsx
const navGroup1 = [
  { key: "Sidebar.nav.overview", href: "/app" },
  { key: "Sidebar.nav.companies", href: "/app/companies" },
  { key: "Sidebar.nav.invoices", href: "/app/invoices" },
];

const navGroup2 = [
  { key: "Sidebar.nav.webhooks", href: "/app/webhooks" },
  { key: "Sidebar.nav.apiKeys", href: "/app/api-keys" },
  { key: "Sidebar.nav.billing", href: "/app/billing" },
  { key: "Sidebar.nav.members", href: "/app/members" },
  { key: "Sidebar.nav.settings", href: "/app/settings" },
];
```

- [ ] **Step 2: Update sidebar balance card**

Replace the balance card section in sidebar.tsx:

```tsx
{/* Balance card — now shows credits used / allowance */}
<div className="mt-auto border border-[#1f1f1f] rounded-[9px] p-3.5 flex flex-col gap-2.5 bg-surface">
  <div className="flex items-center justify-between">
    <span className="font-mono text-[11px] text-text-3 tracking-wide">
      {t("Sidebar.credits")}
    </span>
    <span className="text-[15px] font-semibold">87/200</span>
  </div>
  <div className="h-[3px] bg-[#1f1f1f] rounded-sm overflow-hidden">
    <div className="h-full bg-accent rounded-sm" style={{ width: "43%" }} />
  </div>
  <Link
    href="/app/billing"
    onClick={onClose}
    className="text-[13px] text-accent hover:opacity-80 transition-opacity"
  >
    Ver plano →
  </Link>
</div>
```

- [ ] **Step 3: Update pathToPage in app/app/layout.tsx**

Replace the `pathToPage` record in `app/app/layout.tsx`:

```tsx
const pathToPage: Record<string, string> = {
  "/app": t("Overview.title"),
  "/app/companies": t("Companies.title"),
  "/app/invoices": t("Invoices.title"),
  "/app/invoices/new": t("Invoices.newTitle"),
  "/app/webhooks": t("Webhooks.title"),
  "/app/api-keys": t("ApiKeys.title"),
  "/app/billing": t("Billing.title"),
  "/app/credits": t("Credits.title"),
  "/app/members": t("Members.title"),
  "/app/settings": t("Settings.title"),
};
```

- [ ] **Step 4: Add missing i18n keys to messages files**

In `messages/pt.json` Sidebar section, update/add:

```json
"Sidebar": {
  "nav": {
    "overview": "Visão geral",
    "companies": "Empresas",
    "invoices": "Notas fiscais",
    "webhooks": "Webhooks",
    "apiKeys": "Chaves de API",
    "billing": "Plano",
    "credits": "Créditos",
    "members": "Membros",
    "settings": "Configurações"
  },
  "credits": "CRÉDITOS",
  "balance": "SALDO",
  "buyCredits": "Ver plano →"
},
```

In `messages/en.json`, same structure.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sidebar.tsx app/app/layout.tsx messages/pt.json messages/en.json
git commit -m "feat(dashboard): update sidebar and layout for NFS-e routes"
```

---

## Task 10: Remove WhatsApp legacy pages

**Files:**
- Delete: `app/app/connections/`, `app/app/templates/`, `app/app/messages/`
- Modify: `app/app/page.tsx` (already done in Task 4)

- [ ] **Step 1: Delete legacy directories**

```bash
rm -rf app/app/connections
rm -rf app/app/templates
rm -rf app/app/messages
```

- [ ] **Step 2: Remove legacy types from lib/types.ts**

Remove the following from `lib/types.ts` (these are no longer used in the dashboard):
- `MessageStatus`, `TemplateStatus`, `MessageType`, `ChannelSlug`, `ConnectionStatus`, `PhoneStatus`, `QualityRating`
- `MetaConnection`, `MetaConfig`, `MetaCompleteResponse`, `CoexistenceAttempt`, `AvailablePhone`, `CONNECTION_TYPES`
- `Template`, `CreateTemplateInput`, `UpdateTemplateInput`
- `Message`, `SendMessageInput`
- `Phone`
- `WEBHOOK_EVENT_OPTIONS` (replace with NFS-e events — see below)

**Keep:** User, AuthResponse, ApiKey, Plan, CreditBalance, CreditTransaction, WebhookEndpoint, WebhookDelivery, WebhookPayload, Member, MemberRole

Add NFS-e webhook events to `lib/types.ts`:

```typescript
// ── NFS-e Webhook events ────────────────────────────────────────────────────

export const NFSE_WEBHOOK_EVENTS = [
  { value: "nfse.invoice.authorized", label: "Nota autorizada", description: "Uma NFS-e foi autorizada pela prefeitura." },
  { value: "nfse.invoice.rejected", label: "Nota rejeitada", description: "Uma NFS-e foi rejeitada." },
  { value: "nfse.invoice.failed", label: "Falha na emissão", description: "O processamento da nota falhou." },
] as const;

export type NfseWebhookEvent = (typeof NFSE_WEBHOOK_EVENTS)[number]["value"];
```

- [ ] **Step 3: Update webhook component to use NFS-e events**

Modify `app/app/webhooks/page.tsx` to use `NFSE_WEBHOOK_EVENTS` instead of `WEBHOOK_EVENT_OPTIONS`.

- [ ] **Step 4: Commit**

```bash
git rm -r app/app/connections app/app/templates app/app/messages
git add lib/types.ts
git commit -m "refactor(dashboard): remove WhatsApp legacy pages and types"
```

---

## Task 11: Verify build

**Files:**
- Run: `yarn tsc --noEmit` and `yarn build`

- [ ] **Step 1: Run TypeScript check**

```bash
yarn tsc --noEmit 2>&1 | grep -v "app/app/credits\|lib/mock-data"
```

Expected: zero errors (or only pre-existing errors in unrelated files)

- [ ] **Step 2: Run build**

```bash
yarn build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit (if clean)**

```bash
git add -A && git commit -m "chore: verify build passes after NFS-e pivot"
```

---

## Scope Check

| Spec requirement | Task |
|---|---|
| NFS-e overview with KPIs | Task 4 |
| Companies list | Task 5 |
| Invoice list with filters | Task 6 |
| New invoice form | Task 7 |
| Billing / plan page | Task 8 |
| Sidebar navigation update | Task 9 |
| Remove WhatsApp legacy | Task 10 |
| Build passes | Task 11 |

All requirements covered. No gaps found.

---

## Task 12: Login page — Magic Link + OAuth (remover senha)

**Files:**
- Modify: `app/(auth)/login/page.tsx`, `messages/pt.json`, `messages/en.json`
- Modify: `lib/api.ts` (add magic link auth methods)

**Interfaces:**
- Produces: login page with Magic Link (email → código), OAuth (Google + GitHub), perks NFS-e, snippet NFS-e

- [ ] **Step 1: Add magic link API methods to lib/api.ts**

Add to the `auth` namespace in `lib/api.ts`:

```typescript
export const auth = {
  // ... existing methods remain:
  register: (data: { email: string; password: string; name: string }) => ...,
  login: (email: string, password: string) => ...,
  session: () => ...,
  logout: () => ...,
  me: () => ...,
  googleUrl: () => `${BASE}/v1/auth/google`,
  githubUrl: () => `${BASE}/v1/auth/github`,

  // NEW — Magic Link:
  magicLinkRequest: (email: string) =>
    request<{ expiresAt: string }>("/v1/auth/magic-link/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  magicLinkVerify: (email: string, code: string) =>
    request<ApiEnvelope<SessionPayload>>("/v1/auth/magic-link/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),
};
```

- [ ] **Step 2: Rewrite app/(auth)/login/page.tsx**

Replace the entire file with a Magic Link + OAuth flow. Key changes:
1. Remove `password` state, `name` state, password field, submit handler with `auth.register`/`auth.login`
2. Add `step` state: `"email"` → `"code"` → redirect
3. In `email` step: single email input + "Enviar código" button → calls `auth.magicLinkRequest(email)`
4. In `code` step: show email address + 6-digit code input → calls `auth.magicLinkVerify(email, code)` → on success redirects to `/app`
5. Keep Google + GitHub OAuth buttons (already use `auth.googleUrl()` / `auth.githubUrl()`)
6. Update perks array for NFS-e:
   - "Emissão de NFS-e via API"
   - "Gestão multiempresa"
   - "Automação do fluxo fiscal"
   - "API REST simples"
7. Update code snippet right panel to show:
   ```
   POST /v1/invoices
   Content-Type: application/json
   x-api-key: cv_live_...
   {
     "company_id": "...",
     "customer": { ... },
     "amount": 199.00
   }
   ```
8. Update `freeCreditsTag` → "30 NOTAS GRÁTIS POR MÊS"
9. Update `headline` → "Da primeira emissão à nota fiscal em minutos."
10. Update `footerNote` → "Sem cartão de crédito. Sem contrato. 30 notas grátis para começar."

- [ ] **Step 3: Update Login i18n keys in messages/pt.json and messages/en.json**

```json
"Login": {
  "signupTitle": "Crie sua conta",
  "loginTitle": "Entrar na Corvo",
  "signupSubtitle": "Cadastre-se com e-mail ou rede social. Sem senha.",
  "loginSubtitle": "Acesse sua conta.",
  "signUpWithGoogle": "Continuar com Google",
  "signInWithGoogle": "Entrar com Google",
  "signUpWithGitHub": "Continuar com GitHub",
  "signInWithGitHub": "Entrar com GitHub",
  "emailPlaceholder": "seu@email.com",
  "createAccount": "Criar conta",
  "signIn": "Entrar",
  "alreadyHaveAccount": "Já tem conta?",
  "noAccountYet": "Não tem conta?",
  "termsNote": "Ao criar uma conta você concorda com nossos Termos de Uso e Política de Privacidade.",
  "perks": {
    "nfse": {
      "title": "Emissão de NFS-e via API",
      "desc": "Integre a emissão de notas fiscais ao seu produto com REST simples."
    },
    "multiCompany": {
      "title": "Gestão multiempresa",
      "desc": "Gerencie notas de diferentes CNPJs em uma única conta."
    },
    "automation": {
      "title": "Automação do fluxo fiscal",
      "desc": "Webhooks e status em tempo real para cada emissão."
    },
    "simpleApi": {
      "title": "API REST simples",
      "desc": "Respostas estruturadas, exemplos em Node, Python e Go."
    }
  },
  "freeCreditsTag": "30 NOTAS GRÁTIS POR MÊS",
  "headline": "Da primeira emissão à nota fiscal em minutos.",
  "afterSignup": "APÓS O CADASTRO",
  "footerNote": "Sem cartão de crédito. Sem contrato. 30 notas grátis para começar.",
  "magicLink": {
    "sendCode": "Enviar código",
    "sending": "Enviando...",
    "codeSent": "Código enviado para {email}",
    "enterCode": "Digite o código",
    "codePlaceholder": "123456",
    "resendHint": "Não recebeu? Reenviar em {n}s",
    "resend": "Reenviar código"
  },
  "errors": {
    "invalidCredentials": "E-mail ou código inválido.",
    "expiredCode": "Código expirado. Solicite um novo.",
    "tooManyAttempts": "Muitas tentativas. Aguarde e tente novamente."
  }
}
```

In `messages/en.json` — same structure in English.

- [ ] **Step 4: Commit**

```bash
git add app/\(auth\)/login/page.tsx lib/api.ts messages/pt.json messages/en.json
git commit -m "feat(auth): migrate login to Magic Link + OAuth, remove password, update perks for NFS-e"
```

---

## Scope Check (updated)

| Spec requirement | Task |
|---|---|
| NFS-e overview with KPIs | Task 4 |
| Companies list | Task 5 |
| Invoice list with filters | Task 6 |
| New invoice form | Task 7 |
| Billing / plan page | Task 8 |
| Sidebar navigation update | Task 9 |
| Remove WhatsApp legacy | Task 10 |
| Build passes | Task 11 |
| Login → Magic Link + perks NFS-e | Task 12 |
