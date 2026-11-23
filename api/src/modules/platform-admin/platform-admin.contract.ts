/** HTTP contract of the platform admin (mirrored in web/lib/platform-admin.ts). */

export type Win = {
  authorized: number;
  rejected: number;
  rejectionRate: number | null;
};
export type Windows = { today: Win; d7: Win; d30: Win };
export type Rev = {
  subscriptionCents: number;
  avulsoCents: number;
  totalCents: number;
};

export type PlatformOverview = {
  users: { total: number; new7d: number; new30d: number };
  invoices: { live: Windows; test: Windows };
  revenue: { d7: Rev; d30: Rev; stripeRecordedSince: string | null };
  adminGrants: { units7d: number; units30d: number };
};

export type PlatformUserRow = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  planSlug: string | null;
  liveInvoicesThisMonth: number;
  avulsoBalance: number;
  companiesCount: number;
  lastActivityAt: string | null;
};

export type PlatformUserDetail = {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerifiedAt: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  };
  workspaces: {
    tenantId: string;
    role: string;
    isOwn: boolean;
    plan: { slug: string; name: string } | null;
    usage: {
      included: number;
      authorized: number;
      reserved: number;
      periodEnd: string;
    } | null;
    avulsoBalance: number;
    companies: {
      id: string;
      taxId: string;
      legalName: string;
      municipalityCode: string;
      environment: string;
      certificateValidUntil: string | null;
    }[];
    recentInvoices: {
      id: string;
      status: string;
      amount: number;
      environment: string;
      lastErrorCode: string | null;
      createdAt: string;
    }[];
    credits: {
      id: string;
      type: string;
      source: string | null;
      amount: number;
      description: string | null;
      createdAt: string;
    }[];
    payments: {
      id: string;
      kind: string;
      provider: string;
      amountCents: number;
      status: string;
      paidAt: string | null;
    }[];
    apiKeys: {
      id: string;
      name: string;
      keyPrefix: string;
      environment: string;
      lastUsedAt: string | null;
    }[];
    mcpConnections: {
      id: string;
      clientName: string;
      lastUsedAt: string | null;
    }[];
  }[];
};

export type PlatformAttention = {
  staleInvoices: {
    invoiceId: string;
    tenantId: string;
    userId: string;
    status: string;
    updatedAt: string;
  }[];
  expiringCertificates: {
    companyId: string;
    tenantId: string;
    userId: string;
    taxId: string;
    validUntil: string;
  }[];
  failingWebhooks: {
    tenantId: string;
    userId: string;
    failedCount24h: number;
    lastFailureAt: string;
  }[];
  failedPayments: {
    tenantId: string;
    userId: string;
    source: 'intent' | 'subscription';
    status: string;
    at: string;
  }[];
};

export type PlatformAuditEvent = {
  id: string;
  actorEmail: string;
  action: 'credit_grant' | 'user_viewed';
  targetTenantId: string | null;
  targetUserId: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  success: boolean;
  createdAt: string;
};

export type CreditGrantResult = {
  tenantId: string;
  amount: number;
  balance: number;
  replayed: boolean;
};
