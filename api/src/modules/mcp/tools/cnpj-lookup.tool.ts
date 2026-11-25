import { plainToInstance } from 'class-transformer';
import { IsString, validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { SimplesRegistryPort } from '@/modules/company/domain/registry-check';
import { isValidCnpj, normalizeCnpj } from '@/shared/fiscal/cnpj';
import { invalidInput } from './tool-input-errors';

export const CNPJ_LOOKUP_TOOL = {
  name: 'cnpj_lookup',
  description:
    'Look up the public registration data of any CNPJ (legal name, trade name, address, IBGE municipality code, whether it is Simples Nacional or MEI, and whether it is active). Use it to pre-fill a company or a customer before nfse_issue or company_create. It reads the public registry, not this workspace: use company_get for companies already registered here. Fails when the CNPJ is invalid, when the registry does not know it (CNPJ_NOT_FOUND) or when the registry has no answer right now (CNPJ_LOOKUP_UNAVAILABLE, try again later). Next step of onboarding: company_create.',
  inputSchema: {
    type: 'object',
    properties: {
      cnpj: { type: 'string', description: 'CNPJ; punctuation is optional.' },
    },
    required: ['cnpj'],
  },
} as const;

class CnpjLookupInput {
  @IsString() cnpj!: string;
}

export function createCnpjLookupHandler(
  registry: Pick<SimplesRegistryPort, 'lookupProfile'>,
) {
  return async function cnpjLookupHandler(
    rawParams: unknown,
    _ctx: AuthContext,
  ) {
    const params = plainToInstance(
      CnpjLookupInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const cnpj = normalizeCnpj(params.cnpj);
    if (!isValidCnpj(cnpj)) throw new Error('The CNPJ is not valid');
    const result = await registry.lookupProfile(cnpj);
    if (result.status === 'not_found')
      throw new Error(
        'The public registry does not know this CNPJ (CNPJ_NOT_FOUND): ask the person to check the numbers',
      );
    if (result.status === 'unavailable')
      throw new Error(
        'The public registry has no answer right now (CNPJ_LOOKUP_UNAVAILABLE): try again in a moment, or ask the person for the company data',
      );
    return { profile: result.profile };
  };
}
