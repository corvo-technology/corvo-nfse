export type TenantPermission =
  | 'credits.view'
  | 'credits.manage'
  | 'webhooks.view'
  | 'webhooks.manage'
  | 'integrations.view'
  | 'integrations.manage'
  | 'api_keys.manage'
  | 'settings.manage'
  | 'billing.view'
  | 'billing.manage'
  | 'nfse.companies.view'
  | 'nfse.companies.manage'
  | 'nfse.certificates.view'
  | 'nfse.certificates.manage'
  | 'nfse.invoices.view'
  | 'nfse.invoices.issue';

/** Roles supported for tenant memberships. */
export type TenantMembershipRole = 'admin' | 'developer' | 'billing';

export interface PermissionCatalogItem {
  id: TenantPermission;
  name: string;
  description?: string;
  category: string;
}

export interface PermissionCategoryCatalogItem {
  id: string;
  name: string;
}

export const TENANT_ADMIN_PERMISSIONS: TenantPermission[] = [
  'credits.view',
  'credits.manage',
  'webhooks.view',
  'webhooks.manage',
  'integrations.view',
  'integrations.manage',
  'api_keys.manage',
  'settings.manage',
  'billing.view',
  'billing.manage',
  'nfse.companies.view',
  'nfse.companies.manage',
  'nfse.certificates.view',
  'nfse.certificates.manage',
  'nfse.invoices.view',
  'nfse.invoices.issue',
];

const DEVELOPER_PERMISSIONS: TenantPermission[] = [
  'credits.view',
  'webhooks.view',
  'webhooks.manage',
  'integrations.view',
  'integrations.manage',
  'api_keys.manage',
  'billing.view',
  'nfse.companies.view',
  'nfse.companies.manage',
  'nfse.certificates.view',
  'nfse.invoices.view',
  'nfse.invoices.issue',
];

const BILLING_PERMISSIONS: TenantPermission[] = [
  'credits.view',
  'credits.manage',
  'webhooks.view',
  'billing.view',
  'billing.manage',
  'nfse.companies.view',
  'nfse.invoices.view',
];

export const TENANT_ROLE_PERMISSIONS: Readonly<
  Record<TenantMembershipRole, readonly TenantPermission[]>
> = {
  admin: TENANT_ADMIN_PERMISSIONS,
  developer: DEVELOPER_PERMISSIONS,
  billing: BILLING_PERMISSIONS,
};

export function permissionsForTenantRole(
  role: TenantMembershipRole,
): TenantPermission[] {
  return [...TENANT_ROLE_PERMISSIONS[role]];
}

export const TENANT_PERMISSION_CATEGORY_CATALOG: PermissionCategoryCatalogItem[] =
  [
    { id: 'credits', name: 'Credits' },
    { id: 'webhooks', name: 'Webhooks' },
    { id: 'integrations', name: 'Integrations' },
    { id: 'api_keys', name: 'API Keys' },
    { id: 'settings', name: 'Settings' },
    { id: 'billing', name: 'Billing' },
    { id: 'nfse', name: 'NFS-e' },
  ];

const PERMISSION_LABELS: Record<
  TenantPermission,
  Pick<PermissionCatalogItem, 'name' | 'description' | 'category'>
> = {
  'credits.view': {
    name: 'View credits',
    description: 'Can view credit balance and history',
    category: 'credits',
  },
  'credits.manage': {
    name: 'Manage credits',
    description: 'Can purchase credits',
    category: 'credits',
  },
  'webhooks.view': {
    name: 'View webhooks',
    description: 'Can list and view webhook configurations',
    category: 'webhooks',
  },
  'webhooks.manage': {
    name: 'Manage webhooks',
    description: 'Can create, edit and delete webhooks',
    category: 'webhooks',
  },
  'integrations.view': {
    name: 'View integrations',
    description: 'Can view payment integrations, events and pending operations',
    category: 'integrations',
  },
  'integrations.manage': {
    name: 'Manage integrations',
    description: 'Can connect payment platforms and manage their rules',
    category: 'integrations',
  },
  'api_keys.manage': {
    name: 'Manage API keys',
    description: 'Can create, list and delete API keys',
    category: 'api_keys',
  },
  'settings.manage': {
    name: 'Manage settings',
    description: 'Can manage account settings',
    category: 'settings',
  },
  'billing.manage': {
    name: 'Manage billing',
    description: 'Can manage billing and subscriptions',
    category: 'billing',
  },
  'billing.view': {
    name: 'View billing',
    description: 'Can view current plan and usage',
    category: 'billing',
  },
  'nfse.companies.view': {
    name: 'View NFS-e companies',
    description: 'Can list and view NFS-e companies',
    category: 'nfse',
  },
  'nfse.companies.manage': {
    name: 'Manage NFS-e companies',
    description: 'Can create, edit and delete NFS-e companies',
    category: 'nfse',
  },
  'nfse.certificates.view': {
    name: 'View NFS-e certificates',
    description: 'Can list and view NFS-e certificates',
    category: 'nfse',
  },
  'nfse.certificates.manage': {
    name: 'Manage NFS-e certificates',
    description: 'Can upload and revoke NFS-e certificates',
    category: 'nfse',
  },
  'nfse.invoices.view': {
    name: 'View NFS-e invoices',
    description: 'Can list and view NFS-e invoices',
    category: 'nfse',
  },
  'nfse.invoices.issue': {
    name: 'Issue NFS-e invoices',
    description: 'Can create and emit NFS-e invoices',
    category: 'nfse',
  },
};

export const TENANT_PERMISSION_CATALOG: PermissionCatalogItem[] =
  TENANT_ADMIN_PERMISSIONS.map((permission) => ({
    id: permission,
    ...PERMISSION_LABELS[permission],
  }));
