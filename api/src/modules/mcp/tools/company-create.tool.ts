import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { CreateCompanyInput } from '@/modules/company/domain/company';
import { CompanyCreateInput } from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

export const COMPANY_CREATE_TOOL = {
  name: 'company_create',
  description:
    'Create an issuing company in the connected environment. A certificate is deliberately not accepted here: after the company is created, upload it with certificate_upload (needs the certificate permission granted when connecting). Do not pick default_service_code on your own: if cnpj_lookup returned suggested_service_code, show it to the person and set default_service_code only after they confirm it; otherwise leave it out.',
  inputSchema: {
    type: 'object',
    properties: {
      legal_name: { type: 'string' },
      tax_id: { type: 'string', description: 'CNPJ; punctuation is optional.' },
      tax_regime: {
        type: 'string',
        enum: ['mei', 'simple_national'],
        description:
          'Corvo serves MEI (mei) and Simples Nacional (simple_national) only.',
      },
      municipality_code: {
        type: 'string',
        description: 'Seven-digit IBGE municipality code.',
      },
      trade_name: { type: 'string' },
      municipal_reg: { type: 'string' },
      send_municipal_reg: { type: 'boolean' },
      default_service_code: {
        type: 'string',
        description: 'Six-digit cTribNac service code.',
      },
      simple_national: { type: 'boolean' },
      special_regime: { type: 'string' },
      simples_rate: {
        type: 'string',
        description:
          'Required for Simples Nacional (ignored for MEI): effective total rate (%) of your DAS, e.g. "6.54".',
      },
      simples_iss_rate: {
        type: 'string',
        description:
          'Simples Nacional only, optional: effective ISS rate (%) of your bracket; needed only when a customer withholds ISS.',
      },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          number: { type: 'string' },
          complement: { type: 'string' },
          district: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
        },
      },
    },
    required: ['legal_name', 'tax_id', 'tax_regime', 'municipality_code'],
  },
} as const;

export function createCompanyCreateHandler(companyService: CompanyService) {
  return async function companyCreateHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      CompanyCreateInput,
      rawParams as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const input: CreateCompanyInput = {
      legalName: params.legal_name,
      taxId: params.tax_id,
      taxRegime: params.tax_regime === 'mei' ? 'MEI' : 'Simples Nacional',
      municipalityCode: params.municipality_code,
      tradeName: params.trade_name,
      municipalReg: params.municipal_reg,
      sendMunicipalReg: params.send_municipal_reg,
      defaultServiceCode: params.default_service_code,
      simpleNational: params.simple_national,
      specialRegime: params.special_regime,
      simplesRate: params.simples_rate,
      simplesIssRate: params.simples_iss_rate,
      address: params.address,
    };
    const company = await companyService.create(
      input,
      ctx.tenantId,
      executionEnvironment(ctx),
      ctx.userId ?? null,
    );
    const snapshot = company.toSnapshot();
    return {
      id: snapshot.id,
      legal_name: snapshot.legalName,
      tax_id: snapshot.taxId,
      status: snapshot.status,
      message:
        'Company created. Upload the certificate with certificate_upload before issuing in live.',
    };
  };
}
