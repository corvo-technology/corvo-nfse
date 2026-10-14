import { Company } from './company';
import { VALID_CNPJ } from '@/shared/fiscal/fixtures';

describe('Company', () => {
  describe('create', () => {
    it('creates a company with valid input', () => {
      const input = {
        legalName: 'Acme Corporation',
        taxId: VALID_CNPJ,
        taxRegime: 'Simples Nacional' as const,
        municipalityCode: '3550308',
      };

      const company = Company.create(input, 'tenant-123');

      expect(company.legalName).toBe('Acme Corporation');
      expect(company.taxId).toBe(VALID_CNPJ);
      expect(company.status).toBe('pending_setup');
      expect(company.tenantId).toBe('tenant-123');
      expect(company.id).toBeDefined();
      expect(company.createdAt).toBeInstanceOf(Date);
    });

    it('sets status to pending_setup on creation', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'Lucro Presumido',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      expect(company.status).toBe('pending_setup');
      expect(company.isReady).toBe(false);
    });

    it('throws when legalName is empty', () => {
      expect(() =>
        Company.create(
          {
            legalName: '   ',
            taxId: VALID_CNPJ,
            taxRegime: 'MEI',
            municipalityCode: '3550308',
          },
          'tenant-123',
        ),
      ).toThrow('Company.legalName is required');
    });

    it('throws when taxId is empty', () => {
      expect(() =>
        Company.create(
          {
            legalName: 'Valid Name',
            taxId: '',
            taxRegime: 'MEI',
            municipalityCode: '3550308',
          },
          'tenant-123',
        ),
      ).toThrow('Company.taxId is required');
    });

    it('does not throw when taxRegime is missing (regime lives on the fiscal profile)', () => {
      const company = Company.create(
        {
          legalName: 'Valid Name',
          taxId: VALID_CNPJ,
          municipalityCode: '3550308',
        } as never,
        'tenant-123',
      );
      expect(company.legalName).toBe('Valid Name');
    });

    it('ignores regime input and keeps it off the aggregate snapshot', () => {
      const company = Company.create(
        {
          legalName: 'Valid Name',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          simpleNational: true,
          specialRegime: '3',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );
      const snapshot = company.toSnapshot();
      expect(snapshot).not.toHaveProperty('taxRegime');
      expect(snapshot).not.toHaveProperty('simpleNational');
      expect(snapshot).not.toHaveProperty('specialRegime');
    });

    it('trims whitespace from legalName and taxId', () => {
      const company = Company.create(
        {
          legalName: '  Acme Corp  ',
          taxId: '  11.222.333/0001-81  ',
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      expect(company.legalName).toBe('Acme Corp');
      expect(company.taxId).toBe(VALID_CNPJ);
    });

    it('sets environment to sandbox by default', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      expect(company.environment).toBe('test');
    });

    it('allows production environment when specified', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          environment: 'live',
        },
        'tenant-123',
      );

      expect(company.environment).toBe('live');
    });

    it('stores optional address fields', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          address: {
            street: 'Main Street',
            number: '123',
            city: 'Sao Paulo',
            state: 'SP',
            zip: '01234567',
          },
        },
        'tenant-123',
      );

      expect(company.addressStreet).toBe('Main Street');
      expect(company.addressNumber).toBe('123');
      expect(company.addressCity).toBe('Sao Paulo');
      expect(company.addressState).toBe('SP');
      expect(company.addressZip).toBe('01234567');
    });
  });

  describe('markReady', () => {
    it('marks company as ready when status changes', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: 'INSCRICAO123',
        },
        'tenant-123',
      );

      expect(company.isReady).toBe(false);
      company.markReady();
      expect(company.status).toBe('ready');
      expect(company.isReady).toBe(true);
    });

    it('throws when municipalReg is missing for ready transition', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          environment: 'live', // municipalReg is not set
        },
        'tenant-123',
      );

      expect(() => company.markReady()).toThrow(/missing/i);
      expect(company.status).toBe('pending_setup');
    });

    it('throws when trying to mark a blocked company as ready', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      company.markBlocked();
      expect(() => company.markReady()).toThrow(/blocked/);
    });

    it('increments updatedAt when marking ready', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: 'INSCRICAO123',
        },
        'tenant-123',
      );
      const originalUpdatedAt = company.updatedAt;

      // Wait a tiny bit to ensure time difference
      company.markReady();

      expect(company.updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime(),
      );
    });
  });

  describe('markBlocked', () => {
    it('sets status to blocked', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      company.markBlocked();

      expect(company.status).toBe('blocked');
    });
  });

  describe('update', () => {
    it('updates fields and increments updatedAt', () => {
      const company = Company.create(
        {
          legalName: 'Old Name',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );
      const originalUpdatedAt = company.updatedAt;

      company.update({
        legalName: 'New Name',
        tradeName: 'New Trade Name',
      });

      expect(company.legalName).toBe('New Name');
      expect(company.tradeName).toBe('New Trade Name');
      expect(company.updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime(),
      );
    });

    it('only updates provided fields', () => {
      const company = Company.create(
        {
          legalName: 'Original Name',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          tradeName: 'Original Trade',
        },
        'tenant-123',
      );

      company.update({ tradeName: 'Updated Trade' });

      expect(company.legalName).toBe('Original Name');
      expect(company.tradeName).toBe('Updated Trade');
    });

    it('trims updated strings', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      company.update({
        tradeName: '  Trimmed Trade  ',
        address: { city: '  Sao Paulo  ' },
      });

      expect(company.tradeName).toBe('Trimmed Trade');
      expect(company.addressCity).toBe('Sao Paulo');
    });

    it('ignores regime fields on update (regime lives on the fiscal profile)', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );
      const before = company.toSnapshot();

      company.update({
        taxRegime: 'Lucro Real',
        simpleNational: true,
        specialRegime: '1',
      });

      const after = company.toSnapshot();
      expect(after).not.toHaveProperty('taxRegime');
      expect({ ...after, updatedAt: null }).toEqual({
        ...before,
        updatedAt: null,
      });
    });
  });

  describe('markDeleted', () => {
    it('soft deletes by setting deletedAt', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      expect(company.deletedAt).toBeUndefined();
      expect(company.isDeleted).toBe(false);

      company.markDeleted();

      expect(company.deletedAt).toBeInstanceOf(Date);
      expect(company.isDeleted).toBe(true);
    });
  });

  describe('reconstitute', () => {
    it('reconstitutes from props without validation', () => {
      const props = {
        id: 'company-id',
        tenantId: 'tenant-123',
        legalName: 'Reconstituted Company',
        taxId: '22334455000182',
        municipalityCode: '3550308',
        environment: 'live' as const,
        status: 'ready' as const,
        fiscalSchemaVersion: 'v2_02',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };

      const company = Company.reconstitute(props);

      expect(company.id).toBe('company-id');
      expect(company.legalName).toBe('Reconstituted Company');
      expect(company.status).toBe('ready');
    });
  });

  describe('isReady', () => {
    it('returns true only when status is ready', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: 'INSCRICAO123',
        },
        'tenant-123',
      );

      expect(company.isReady).toBe(false);

      company.markReady();
      expect(company.isReady).toBe(true);

      company.markBlocked();
      expect(company.isReady).toBe(false);
    });
  });

  describe('getMissingForReady', () => {
    it('returns municipal_registration when missing', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          environment: 'live',
        },
        'tenant-123',
      );

      expect(company.getMissingForReady()).toContain('municipal_registration');
    });

    it('returns empty array when all required fields present', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: 'VALID_REG',
        },
        'tenant-123',
      );

      expect(company.getMissingForReady()).toHaveLength(0);
    });
  });

  describe('toSnapshot', () => {
    it('returns all props', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      const snapshot = company.toSnapshot();

      expect(snapshot.id).toBe(company.id);
      expect(snapshot.tenantId).toBe('tenant-123');
      expect(snapshot.legalName).toBe('Test Company');
      expect(snapshot.taxId).toBe(VALID_CNPJ);
      expect(snapshot.status).toBe('pending_setup');
    });

    it('returns a copy, not the original props', () => {
      const company = Company.create(
        {
          legalName: 'Test Company',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        'tenant-123',
      );

      const snapshot = company.toSnapshot();
      snapshot.legalName = 'Modified';

      expect(company.legalName).toBe('Test Company');
    });
  });

  describe('getSetupGaps', () => {
    it('returns municipal_registration for live without municipalReg', () => {
      const company = Company.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          environment: 'live',
        },
        't',
      );
      expect(company.getSetupGaps()).toContain('municipal_registration');
    });
    it('returns empty for live with municipalReg', () => {
      const company = Company.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: '123456',
          environment: 'live',
        },
        't',
      );
      expect(company.getSetupGaps()).toHaveLength(0);
    });
    it('returns empty for test without municipalReg', () => {
      const company = Company.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          environment: 'test',
        },
        't',
      );
      expect(company.getSetupGaps()).toHaveLength(0);
    });
  });

  describe('recomputeStatus', () => {
    it('sets ready when gaps empty and hasActiveCertificate', () => {
      const company = Company.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: '123',
          environment: 'live',
        },
        't',
      );
      company.recomputeStatus(true);
      expect(company.status).toBe('ready');
    });
    it('sets pending_setup when has gaps', () => {
      const company = Company.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          environment: 'live',
        },
        't',
      );
      company.recomputeStatus(true);
      expect(company.status).toBe('pending_setup');
    });
    it('sets pending_setup when no cert', () => {
      const company = Company.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: '123',
          environment: 'live',
        },
        't',
      );
      company.recomputeStatus(false);
      expect(company.status).toBe('pending_setup');
    });
    it('does NOT override blocked', () => {
      const company = Company.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: '123',
          environment: 'live',
        },
        't',
      );
      company.markBlocked();
      company.recomputeStatus(true);
      expect(company.status).toBe('blocked');
    });
  });

  describe('update with municipalReg null', () => {
    it('clears municipalReg when null', () => {
      const company = Company.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
          municipalReg: '123',
        },
        't',
      );
      company.update({ municipalReg: null });
      expect(company.municipalReg).toBeUndefined();
    });
    it('throws when municipalReg is blank', () => {
      const company = Company.create(
        { legalName: 'X', taxId: VALID_CNPJ, taxRegime: 'MEI' },
        't',
      );
      expect(() => company.update({ municipalReg: '  ' })).toThrow('blank');
    });
  });

  describe('normalizeTaxId on create', () => {
    it('normalizes CNPJ with punctuation', () => {
      const company = Company.create(
        { legalName: 'X', taxId: '11.222.333/0001-81', taxRegime: 'MEI' },
        't',
      );
      expect(company.taxId).toBe(VALID_CNPJ);
    });
  });
});
