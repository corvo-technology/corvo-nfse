import type {
  Company,
  Invoice,
  BillingPlan,
} from "./types";

// ── Companies ────────────────────────────────────────────────────────────────

export const MOCK_COMPANIES: Company[] = [
  {
    id: "comp_001",
    tenantId: "tenant_001",
    environment: "test",
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
    environment: "test",
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

const sampleInvoices: Omit<Invoice, "customerSnapshot" | "serviceSnapshot" | "competenceDate">[] = [
  {
    id: "inv_001",
    tenantId: "tenant_001",
    companyId: "comp_001",
    externalId: "pedido-1001",
    accessKey: "NFSe35503080612345678000199450001000000123450001",
    nfseNumber: 12345,
    status: "authorized",
    amount: 1990.0,
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
    amount: 4500.0,
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
    nfseNumber: 12344,
    status: "authorized",
    amount: 890.0,
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
    amount: 2500.0,
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
    amount: 1200.0,
    customerName: "Zeta Alimentos LTDA",
    customerTaxId: "11002233000144",
    serviceDescription: "Suporte técnico especializado",
    authorizedAt: daysAgo(12),
    createdAt: daysAgo(12),
    updatedAt: daysAgo(12),
  },
];

export const MOCK_INVOICES: Invoice[] = sampleInvoices.map((invoice) => ({ ...invoice, competenceDate: invoice.createdAt, customerSnapshot: { name: invoice.customerName, taxId: invoice.customerTaxId }, serviceSnapshot: { description: invoice.serviceDescription, code: "010101", municipalityCode: "3550308" } }));

// ── Billing ───────────────────────────────────────────────────────────────

export const MOCK_BILLING: BillingPlan = {
  slug: "developer",
  name: "Developer",
  monthlyPriceCents: 2990,
  subscription: { status: "active", paidUntil: null, cancelAtPeriodEnd: false, scheduledPlan: null, blocked: false, pixSubscription: null, stripePortalAvailable: false, stripeSubscription: false },
  usage: {
    creditsUsed: 87,
    creditsReserved: 3,
    creditsRemaining: 163,
    monthlyAllowance: 250,
    dailyUsage: 5,
    dailyLimit: null,
    activeCompanies: 1,
    maxActiveCompanies: 999999,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    avulsoBalance: 0,
  },
};
