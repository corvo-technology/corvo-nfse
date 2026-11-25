import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import * as sentry from '@/infra/observability/sentry-reporter';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { CertificateService } from '@/modules/certificate/application/certificate.service';
import { CertificateInvalidError } from '@/modules/certificate/domain/errors';
import { CompanyService } from '@/modules/company/application/company.service';
import type { AuthContext } from '../auth/auth-context';
import { ITenantMembershipRepository } from '../auth/domain/tenant-membership.repository';
import { McpService } from './mcp.service';

const PASSWORD = 'S3nh@-Secreta-123';
const PFX = Buffer.from('PFX-MARKER-0123456789-abcdefghijklmnop-end');
const PFX_B64 = PFX.toString('base64');

const company = { id: 'company-1', taxId: '11222333000181' };

function parsed() {
  return {
    serialNumber: '01',
    issuer: 'CN=AC',
    subject: 'CN=EMPRESA TESTE:11222333000181',
    fingerprint: 'FP',
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2099-01-01'),
    p12Buffer: PFX,
  };
}

type Mock = { mockImplementation: (fn: () => unknown) => unknown };
type Parser = {
  parseP12: Mock & { mockReturnValue: (value: unknown) => unknown };
};
type Encryptor = {
  encrypt: { mockRejectedValue: (value: unknown) => unknown };
};

type Scenario = {
  name: string;
  setup: (parser: Parser, encryptor: Encryptor) => void;
  args?: Record<string, unknown>;
};

const scenarios: Scenario[] = [
  { name: 'success', setup: () => undefined },
  {
    name: 'wrong password',
    setup: (parser) =>
      parser.parseP12.mockImplementation(() => {
        throw new CertificateInvalidError(`bad mac ${PASSWORD}`);
      }),
  },
  {
    name: 'expired',
    setup: (parser) =>
      parser.parseP12.mockReturnValue({
        ...parsed(),
        validUntil: new Date('2020-01-01T12:00:00Z'),
      }),
  },
  {
    name: 'cnpj mismatch',
    setup: (parser) =>
      parser.parseP12.mockReturnValue({ ...parsed(), taxId: '99888777000166' }),
  },
  {
    name: 'unknown error that carries the password',
    setup: (_parser, encryptor) =>
      encryptor.encrypt.mockRejectedValue(
        new Error(`kms failed for ${PASSWORD} ${PFX_B64}`),
      ),
  },
  {
    name: 'invalid parameter',
    setup: () => undefined,
    args: { password: { nested: PASSWORD }, pfx_base64: PFX_B64 },
  },
];

function build(fakeAudit: FakeAccountAudit) {
  const parser = { parseP12: jest.fn(), extractCNPJFromSubject: jest.fn() };
  parser.parseP12.mockReturnValue(parsed());
  parser.extractCNPJFromSubject.mockReturnValue('11222333000181');
  const encryptor = {
    encrypt: jest.fn().mockResolvedValue({
      encryptedBlob: Buffer.from('b'),
      encryptedDek: Buffer.from('d'),
      dekIv: Buffer.from('i'),
    }),
  };
  const certRepo = {
    findActiveByCompanyId: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const companyRepo = {
    findByIdAndTenantId: jest
      .fn()
      .mockResolvedValue({ ...company, recomputeStatus: jest.fn() }),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const certificates = new CertificateService(
    certRepo as never,
    companyRepo as never,
    encryptor as never,
    parser as never,
    { refresh: jest.fn().mockResolvedValue(null) } as never,
    fakeAudit,
  );
  const deps: unknown[] = Array.from({ length: McpService.length }, () => ({}));
  const slotOf = (token: unknown): number => {
    const types = Reflect.getMetadata('design:paramtypes', McpService) as
      unknown[] | undefined;
    const injected = Reflect.getMetadata('self:paramtypes', McpService) as {
      index: number;
      param: unknown;
    }[];
    const byToken = injected.find((p) => p.param === token);
    const index = byToken ? byToken.index : (types ?? []).indexOf(token);
    if (index < 0) throw new Error('McpService dependency slot not found');
    return index;
  };
  deps[slotOf(CompanyService)] = {
    findByTaxId: jest.fn().mockResolvedValue(company),
  };
  deps[slotOf(CertificateService)] = certificates;
  deps[slotOf(ITenantMembershipRepository)] = {
    findByAuthUserAndTenant: () =>
      Promise.resolve({ role: 'admin', isActive: true }),
  };
  const mcp = new (
    McpService as unknown as new (...args: unknown[]) => McpService
  )(...deps);
  return { mcp, parser, encryptor };
}

describe('certificate_upload never leaks the password or the file', () => {
  const calls: unknown[][] = [];
  const record = (...args: unknown[]) => {
    calls.push(args);
  };

  beforeEach(() => {
    calls.length = 0;
    for (const method of [
      'log',
      'warn',
      'error',
      'debug',
      'verbose',
    ] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation(record);
      jest.spyOn(Logger, method).mockImplementation(record);
    }
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(console, method).mockImplementation(record);
    }
    jest
      .spyOn(sentry, 'captureRuntimeException')
      .mockImplementation((...args: unknown[]) => {
        record(...args);
        return undefined;
      });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(scenarios)('$name', async ({ setup, args }) => {
    const fakeAudit = new FakeAccountAudit();
    const { mcp, parser, encryptor } = build(fakeAudit);
    setup(parser, encryptor);

    const response = await mcp.getServer().handleRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'certificate_upload',
          arguments: {
            tax_id: '11.222.333/0001-81',
            pfx_base64: PFX_B64,
            password: PASSWORD,
            ...args,
          },
        },
      },
      {
        scope: 'nfse:read nfse:write nfse:certificates',
        authUserId: 'user-1',
        activeTenantId: 'tenant-1',
        tenantId: 'tenant-1',
        executionEnvironment: 'live',
      } as AuthContext,
    );

    expect(response).not.toBeNull();
    for (const text of [
      JSON.stringify(response),
      JSON.stringify(calls),
      JSON.stringify(fakeAudit.events),
    ]) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(PFX_B64.slice(0, 32));
    }
  });

  it('still reports an expired certificate to the agent', async () => {
    const { mcp, parser } = build(new FakeAccountAudit());
    parser.parseP12.mockReturnValue({
      ...parsed(),
      validUntil: new Date('2020-01-01T12:00:00Z'),
    });
    const response = await mcp.getServer().handleRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'certificate_upload',
          arguments: {
            tax_id: '11222333000181',
            pfx_base64: PFX_B64,
            password: PASSWORD,
          },
        },
      },
      {
        scope: 'nfse:certificates',
        authUserId: 'u',
        activeTenantId: 't',
        tenantId: 't',
        executionEnvironment: 'live',
      } as AuthContext,
    );
    expect(response).toMatchObject({ result: { isError: true } });
    expect(JSON.stringify(response)).toContain('Certificado vencido em');
  });
});
