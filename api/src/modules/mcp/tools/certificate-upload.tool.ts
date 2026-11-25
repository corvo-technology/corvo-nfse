import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CertificateService } from '@/modules/certificate/application/certificate.service';
import {
  CertificateExpiredError,
  CertificateInvalidError,
  CertificateTaxIdMismatchError,
} from '@/modules/certificate/domain/errors';
import type { CompanyService } from '@/modules/company/application/company.service';
import { CompanyNotFoundError } from '@/modules/company/domain/errors';

export const MAX_PFX_BYTES = 50 * 1024;
export const MAX_PFX_BASE64_CHARS = 70_000;

export const CERTIFICATE_UPLOAD_TOOL = {
  name: 'certificate_upload',
  description:
    "Upload the A1 digital certificate (.pfx/.p12, base64) and its password for a company that already exists in the connected environment. The password comes from the agent's secret vault: never ask the user to paste it in chat if you can avoid it. Corvo stores both encrypted and never returns them. Replaces the company's previous certificate. Afterwards call company_fiscal_status to confirm the company is ready.",
  inputSchema: {
    type: 'object',
    properties: {
      tax_id: { type: 'string', description: 'CNPJ of the company.' },
      pfx_base64: {
        type: 'string',
        description:
          'The .pfx/.p12 file encoded in base64 (up to 50 KB decoded). A data:...;base64, prefix and line breaks are accepted.',
      },
      password: {
        type: 'string',
        description: 'Password of the certificate file.',
      },
    },
    required: ['tax_id', 'pfx_base64', 'password'],
  },
} as const;

class CertificateUploadInput {
  @IsString() @IsNotEmpty() tax_id!: string;
  @IsString() @IsNotEmpty() pfx_base64!: string;
  @IsString() @IsNotEmpty() password!: string;
}

/** Message that is safe to show: fixed text or public data only. */
class CertificateToolError extends Error {}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL_PREFIX = /^data:[^,]*;base64,/i;

function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : value;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function holderOf(subject: string): string {
  const cn = /(?:^|,\s*)CN=([^,]+)/i.exec(subject);
  return (cn?.[1] ?? subject).trim();
}

function decodePfx(raw: string): Buffer {
  const text = raw.trim().replace(DATA_URL_PREFIX, '').replace(/\s+/g, '');
  if (text.length > MAX_PFX_BASE64_CHARS) {
    throw new CertificateToolError('O arquivo tem mais de 50 KB.');
  }
  if (!BASE64_PATTERN.test(text)) {
    throw new CertificateToolError(
      'O arquivo do certificado não está em base64.',
    );
  }
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length > MAX_PFX_BYTES) {
    throw new CertificateToolError('O arquivo tem mais de 50 KB.');
  }
  return bytes;
}

function toSafeError(error: unknown): Error {
  if (error instanceof CertificateToolError) return new Error(error.message);
  if (error instanceof CertificateInvalidError) {
    return new Error('Senha errada ou arquivo inválido.');
  }
  if (error instanceof CertificateExpiredError) {
    return new Error(`Certificado vencido em ${formatDate(error.validUntil)}.`);
  }
  if (error instanceof CertificateTaxIdMismatchError) {
    const details = error.safeDetails;
    return new Error(
      details
        ? `O CNPJ do certificado é ${formatCnpj(details.certificateTaxId)}, o da empresa é ${formatCnpj(details.companyTaxId)}.`
        : 'O CNPJ do certificado é diferente do CNPJ da empresa.',
    );
  }
  if (error instanceof CompanyNotFoundError) {
    return new Error(
      'Empresa não encontrada neste ambiente. Cadastre com company_create antes de enviar o certificado.',
    );
  }
  // Never forward the raw error: libraries may echo the password in it.
  return new Error('Não foi possível salvar o certificado. Tente de novo.');
}

export function createCertificateUploadHandler(
  companies: Pick<CompanyService, 'findByTaxId'>,
  certificates: Pick<CertificateService, 'upload' | 'listByCompany'>,
) {
  return async function certificateUploadHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{
    tax_id: string;
    holder: string;
    valid_until: string;
    environment: 'test' | 'live';
    replaced: boolean;
    message: string;
  }> {
    const params = plainToInstance(
      CertificateUploadInput,
      (rawParams && typeof rawParams === 'object' ? rawParams : {}) as Record<
        string,
        unknown
      >,
    );
    const errors = await validate(params);
    if (errors.length > 0) {
      // Names only the fields: a value (password, file) must never be echoed.
      const fields = errors.map((error) => error.property).join(', ');
      throw new Error(
        `Invalid input: ${fields} must be a non-empty string. Required: tax_id, pfx_base64, password.`,
      );
    }
    try {
      const file = decodePfx(params.pfx_base64);
      const environment = executionEnvironment(ctx);
      const company = await companies.findByTaxId(
        params.tax_id,
        ctx.tenantId,
        environment,
      );
      const previous = await certificates.listByCompany(
        company.id,
        ctx.tenantId,
        environment,
      );
      const certificate = await certificates.upload(
        company.id,
        ctx.tenantId,
        file,
        params.password,
        environment,
      );
      const replaced = previous.length > 0;
      return {
        tax_id: company.taxId,
        holder: holderOf(certificate.subject),
        valid_until: certificate.validUntil.toISOString(),
        environment,
        replaced,
        message: replaced
          ? 'Certificado salvo. Ele substituiu o certificado anterior desta empresa.'
          : 'Certificado salvo.',
      };
    } catch (error) {
      throw toSafeError(error);
    }
  };
}
