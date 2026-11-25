import 'reflect-metadata';
import {
  CertificateExpiredError,
  CertificateInvalidError,
  CertificateTaxIdMismatchError,
} from '@/modules/certificate/domain/errors';
import { CompanyNotFoundError } from '@/modules/company/domain/errors';
import {
  MAX_PFX_BYTES,
  createCertificateUploadHandler,
} from './certificate-upload.tool';

const PASSWORD = 'S3nh@-Secreta-123';
const FILE = Buffer.from('pfx-bytes-marker');
const FILE_B64 = FILE.toString('base64');
const ctx = {
  tenantId: 'tenant-1',
  executionEnvironment: 'live',
} as never;

function setup() {
  const companies = {
    findByTaxId: jest
      .fn()
      .mockResolvedValue({ id: 'company-1', taxId: '11222333000181' }),
  };
  const certificates = {
    upload: jest.fn().mockResolvedValue({
      subject: 'CN=EMPRESA TESTE LTDA:11222333000181, OU=RFB e-CNPJ A1',
      validUntil: new Date('2027-05-10T12:00:00.000Z'),
      status: 'active',
    }),
    listByCompany: jest.fn().mockResolvedValue([]),
  };
  const handler = createCertificateUploadHandler(companies, certificates);
  const call = (args: Record<string, unknown> = {}) =>
    handler(
      {
        tax_id: '11.222.333/0001-81',
        pfx_base64: FILE_B64,
        password: PASSWORD,
        ...args,
      },
      ctx,
    );
  return { companies, certificates, call };
}

describe('certificate_upload', () => {
  it('uploads through CertificateService in the connection environment and returns only public data', async () => {
    const { certificates, call } = setup();
    const result = await call();
    expect(certificates.upload).toHaveBeenCalledWith(
      'company-1',
      'tenant-1',
      FILE,
      PASSWORD,
      'live',
    );
    expect(result).toEqual({
      tax_id: '11222333000181',
      holder: 'EMPRESA TESTE LTDA:11222333000181',
      valid_until: '2027-05-10T12:00:00.000Z',
      environment: 'live',
      replaced: false,
      message: 'Certificado salvo.',
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(Object.keys(result)).not.toContain('password');
    expect(Object.keys(result)).not.toContain('pfx');
  });

  it('says when it replaced the active certificate', async () => {
    const { certificates, call } = setup();
    certificates.listByCompany.mockResolvedValue([{ id: 'old' }]);
    await expect(call()).resolves.toMatchObject({
      replaced: true,
      message:
        'Certificado salvo. Ele substituiu o certificado anterior desta empresa.',
    });
  });

  it('accepts line breaks and a data:...;base64, prefix', async () => {
    const { certificates, call } = setup();
    const wrapped = `data:application/x-pkcs12;base64,${FILE_B64.slice(0, 8)}\r\n${FILE_B64.slice(8)}\n`;
    await call({ pfx_base64: wrapped });
    expect(certificates.upload).toHaveBeenCalledWith(
      'company-1',
      'tenant-1',
      FILE,
      PASSWORD,
      'live',
    );
  });

  it('refuses a file larger than 50 KB without echoing it', async () => {
    const { certificates, call } = setup();
    const big = Buffer.alloc(MAX_PFX_BYTES + 1, 7).toString('base64');
    const error = await call({ pfx_base64: big }).catch((e: Error) => e);
    expect((error as Error).message).toBe('O arquivo tem mais de 50 KB.');
    expect((error as Error).message).not.toContain(big.slice(0, 16));
    expect(certificates.upload).not.toHaveBeenCalled();
  });

  it('refuses text that is not base64 without echoing it', async () => {
    const { certificates, call } = setup();
    const error = await call({ pfx_base64: 'isto não é base64 !!' }).catch(
      (e: Error) => e,
    );
    expect((error as Error).message).toBe(
      'O arquivo do certificado não está em base64.',
    );
    expect((error as Error).message).not.toContain('isto');
    expect(certificates.upload).not.toHaveBeenCalled();
  });

  it('maps a wrong password or invalid file to a simple message', async () => {
    const { certificates, call } = setup();
    certificates.upload.mockRejectedValue(
      new CertificateInvalidError(`bad mac for ${PASSWORD}`),
    );
    await expect(call()).rejects.toThrow('Senha errada ou arquivo inválido.');
  });

  it('maps an expired certificate', async () => {
    const { certificates, call } = setup();
    certificates.upload.mockRejectedValue(
      new CertificateExpiredError(new Date('2026-01-31T12:00:00.000Z')),
    );
    await expect(call()).rejects.toThrow('Certificado vencido em 31/01/2026.');
  });

  it('maps a CNPJ mismatch using only public CNPJs', async () => {
    const { certificates, call } = setup();
    certificates.upload.mockRejectedValue(
      new CertificateTaxIdMismatchError('11222333000181', '99888777000166'),
    );
    await expect(call()).rejects.toThrow(
      'O CNPJ do certificado é 11.222.333/0001-81, o da empresa é 99.888.777/0001-66.',
    );
  });

  it('tells the agent to create the company first when it does not exist', async () => {
    const { companies, certificates, call } = setup();
    companies.findByTaxId.mockRejectedValue(new CompanyNotFoundError('x'));
    await expect(call()).rejects.toThrow(/company_create/);
    expect(certificates.upload).not.toHaveBeenCalled();
  });

  it('reports unknown failures without the raw error', async () => {
    const { certificates, call } = setup();
    certificates.upload.mockRejectedValue(new Error(`${PASSWORD} bad mac`));
    const error = (await call().catch((e: Error) => e)) as Error;
    expect(error.message).toBe(
      'Não foi possível salvar o certificado. Tente de novo.',
    );
    expect(error.message).not.toContain(PASSWORD);
    expect(error.cause).toBeUndefined();
  });

  it('names only the invalid fields on validation errors', async () => {
    const { certificates, call } = setup();
    const error = (await call({ password: 123456 }).catch(
      (e: Error) => e,
    )) as Error;
    expect(error.message).toContain('password');
    expect(error.message).not.toContain('123456');
    expect(certificates.upload).not.toHaveBeenCalled();
  });
});
