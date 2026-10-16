export const session = {
  status: "authenticated" as const,
  context: { authUserId: "user-1", activeTenantId: "tenant-1", role: "admin", permissions: ["nfse.companies.view", "nfse.companies.manage", "nfse.invoices.view", "nfse.invoices.issue", "nfse.certificates.view", "nfse.certificates.manage", "billing.view", "settings.manage", "api_keys.manage", "webhooks.view", "webhooks.manage"], availableTenants: [] },
  activeTenantId: "tenant-1", availableTenants: [{ tenantId: "tenant-1", membershipId: "membership-1", role: "admin", establishmentName: "Test Workspace" }],
  permissions: ["nfse.companies.view", "nfse.companies.manage", "nfse.invoices.view", "nfse.invoices.issue", "nfse.certificates.view", "nfse.certificates.manage", "billing.view", "settings.manage", "api_keys.manage", "webhooks.view", "webhooks.manage"],
  expiresAt: "2099-01-01T00:00:00.000Z", csrfToken: "test-csrf",
};
export const company = { id: "company-1", tenantId: "tenant-1", legalName: "Example LTDA", tradeName: "Example", taxId: "12345678000195", taxRegime: "Simples Nacional", environment: "sandbox", status: "pending_setup", municipalReg: "123", municipalityCode: "3550308", addressCity: "São Paulo", addressState: "SP", createdAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z" };
export const invoice = { id: "invoice-1", tenantId: "tenant-1", companyId: "company-1", externalId: "order-1", customerSnapshot: { taxId: "12345678909", name: "Customer" }, serviceSnapshot: { description: "Consulting", code: "valid-code", municipalityCode: "3550308" }, amount: 150, competenceDate: "2026-10-09", status: "authorized", nfseNumber: 123, createdAt: "2026-10-09T12:00:00.000Z", updatedAt: "2026-10-09T12:00:00.000Z" };
