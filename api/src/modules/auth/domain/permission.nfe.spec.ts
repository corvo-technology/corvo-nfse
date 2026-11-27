import { permissionsForApiKeyScope } from '../application/auth-context.service';
import {
  permissionsForTenantRole,
  TENANT_PERMISSION_CATALOG,
} from './permission';

describe('NF-e permissions', () => {
  it('gives billing only the view permission', () => {
    const billing = permissionsForTenantRole('billing');
    expect(billing).toContain('nfe.documents.view');
    expect(billing).not.toContain('nfe.documents.issue');
    expect(billing).not.toContain('nfe.documents.manage');
  });

  it('gives admin and developer all three', () => {
    for (const role of ['admin', 'developer'] as const)
      expect(permissionsForTenantRole(role)).toEqual(
        expect.arrayContaining([
          'nfe.documents.view',
          'nfe.documents.issue',
          'nfe.documents.manage',
        ]),
      );
  });

  it('keeps every NFS-e permission each role already had', () => {
    expect(permissionsForTenantRole('admin')).toEqual(
      expect.arrayContaining([
        'nfse.companies.view',
        'nfse.companies.manage',
        'nfse.certificates.view',
        'nfse.certificates.manage',
        'nfse.invoices.view',
        'nfse.invoices.issue',
      ]),
    );
    expect(permissionsForTenantRole('developer')).toEqual(
      expect.arrayContaining([
        'nfse.companies.view',
        'nfse.companies.manage',
        'nfse.certificates.view',
        'nfse.invoices.view',
        'nfse.invoices.issue',
      ]),
    );
    expect(permissionsForTenantRole('billing')).toEqual(
      expect.arrayContaining(['nfse.companies.view', 'nfse.invoices.view']),
    );
  });

  it('adds NF-e to the API key scopes without taking anything away', () => {
    expect(permissionsForApiKeyScope('full_access')).toContain(
      'nfe.documents.manage',
    );
    expect(permissionsForApiKeyScope('invoices_read_write')).toEqual(
      expect.arrayContaining(['nfe.documents.view', 'nfe.documents.issue']),
    );
    expect(permissionsForApiKeyScope('invoices_issue')).toEqual([
      'nfse.invoices.issue',
      'nfe.documents.issue',
    ]);
    expect(permissionsForApiKeyScope('invoices_view')).toEqual([
      'nfse.invoices.view',
      'nfe.documents.view',
    ]);
  });

  it('lists the NF-e permissions in the catalog', () => {
    expect(
      TENANT_PERMISSION_CATALOG.filter((p) => p.category === 'nfe').map(
        (p) => p.id,
      ),
    ).toEqual([
      'nfe.documents.view',
      'nfe.documents.issue',
      'nfe.documents.manage',
    ]);
  });
});
