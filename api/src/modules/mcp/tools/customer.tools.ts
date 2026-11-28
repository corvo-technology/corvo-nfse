import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type {
  CustomerDirectory,
  CustomerScope,
  SavedCustomer,
} from '@/modules/invoice/domain/customer-directory';
import { parseCustomerTaxId } from '@/shared/tax-id';
import {
  CustomerDeleteInput,
  CustomerListInput,
  CustomerUpdateInput,
} from '../dto/tool-input.dto';
import { invalidInput } from './tool-input-errors';

const TAX_ID = {
  tax_id: {
    type: 'string',
    description:
      'CPF or CNPJ of the saved customer, with or without punctuation',
  },
} as const;

export const CUSTOMER_LIST_TOOL = {
  name: 'customer_list',
  description:
    'List the customers saved from earlier invoices, most recently used first. Use it to find the CPF/CNPJ of a customer by name before issuing: an invoice for a saved customer needs only the tax_id, the name is filled in.',
  inputSchema: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: 'Part of the name, or the first digits of the CPF/CNPJ',
      },
      limit: { type: 'number', description: '1 to 100 (default 20)' },
      offset: { type: 'number', description: 'Items to skip (default 0)' },
    },
  },
} as const;

export const CUSTOMER_UPDATE_TOOL = {
  name: 'customer_update',
  description:
    'Correct the name, email, NF-e address or state registration (IE) of a saved customer. Applies to the next invoices only; invoices already issued do not change. Send a field as null to remove it. An NF-e for a saved customer is filled from this address and IE.',
  inputSchema: {
    type: 'object',
    properties: {
      ...TAX_ID,
      name: { type: 'string', maxLength: 300 },
      email: { type: ['string', 'null'] },
      address: {
        type: ['object', 'null'],
        description: 'Recipient address for NF-e; null removes it',
        properties: {
          street: { type: 'string' },
          number: { type: 'string' },
          complement: { type: ['string', 'null'] },
          district: { type: 'string' },
          zip: { type: 'string', description: 'CEP, 8 digits' },
          city_code: { type: 'string', description: 'IBGE code, 7 digits' },
          city: { type: 'string' },
          state: { type: 'string', description: 'UF, e.g. SP' },
        },
        required: [
          'street',
          'number',
          'district',
          'zip',
          'city_code',
          'city',
          'state',
        ],
      },
      ind_ie_dest: {
        type: ['integer', 'null'],
        description: '1 contributor, 2 exempt, 9 non-contributor',
      },
      state_registration: { type: ['string', 'null'] },
    },
    required: ['tax_id'],
  },
} as const;

export const CUSTOMER_DELETE_TOOL = {
  name: 'customer_delete',
  description:
    'Forget a saved customer. Invoices already issued do not change; the name is no longer filled in for that CPF/CNPJ.',
  inputSchema: {
    type: 'object',
    properties: TAX_ID,
    required: ['tax_id'],
  },
} as const;

type Directory = Pick<CustomerDirectory, 'list' | 'update' | 'remove'>;

const scopeOf = (ctx: AuthContext): CustomerScope => ({
  tenantId: ctx.activeTenantId,
  environment: executionEnvironment(ctx),
});

const toWire = (customer: SavedCustomer) => ({
  tax_id: customer.taxId,
  name: customer.name,
  email: customer.email,
  address: customer.address && {
    street: customer.address.street,
    number: customer.address.number,
    complement: customer.address.complement,
    district: customer.address.district,
    zip: customer.address.zip,
    city_code: customer.address.cityCode,
    city: customer.address.city,
    state: customer.address.state,
  },
  ind_ie_dest: customer.indIeDest,
  state_registration: customer.stateRegistration,
  last_used_at: customer.lastUsedAt.toISOString(),
});

async function parse<T extends object>(
  type: new () => T,
  raw: unknown,
): Promise<T> {
  const params = plainToInstance(type, raw as Record<string, unknown>);
  const errors = await validate(params);
  if (errors.length > 0) throw invalidInput(errors);
  return params;
}

function taxIdOf(raw: string): string {
  const parsed = parseCustomerTaxId(raw);
  if (!parsed)
    throw new Error('Invalid input: tax_id: not a valid CPF or CNPJ');
  return parsed.value;
}

export function createCustomerListHandler(directory: Directory) {
  return async (rawParams: unknown, ctx: AuthContext) => {
    const params = await parse(CustomerListInput, rawParams ?? {});
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const result = await directory.list(
      scopeOf(ctx),
      { search: params.search },
      { limit, offset },
    );
    return {
      customers: result.items.map(toWire),
      total: result.total,
      limit,
      offset,
    };
  };
}

export function createCustomerUpdateHandler(directory: Directory) {
  return async (rawParams: unknown, ctx: AuthContext) => {
    const params = await parse(CustomerUpdateInput, rawParams);
    if (
      params.name === undefined &&
      params.email === undefined &&
      params.address === undefined &&
      params.ind_ie_dest === undefined &&
      params.state_registration === undefined
    )
      throw new Error(
        'Invalid input: send name, email, address, ind_ie_dest or state_registration to change',
      );
    const customer = await directory.update(
      scopeOf(ctx),
      taxIdOf(params.tax_id),
      {
        name: params.name?.trim(),
        email: params.email,
        address:
          params.address === undefined || params.address === null
            ? params.address
            : {
                street: params.address.street.trim(),
                number: params.address.number.trim(),
                complement: params.address.complement?.trim() || null,
                district: params.address.district.trim(),
                zip: params.address.zip,
                cityCode: params.address.city_code,
                city: params.address.city.trim(),
                state: params.address.state,
              },
        indIeDest: params.ind_ie_dest,
        stateRegistration:
          typeof params.state_registration === 'string'
            ? params.state_registration.trim() || null
            : params.state_registration,
      },
    );
    if (!customer) throw new Error('Customer not found');
    return toWire(customer);
  };
}

export function createCustomerDeleteHandler(directory: Directory) {
  return async (rawParams: unknown, ctx: AuthContext) => {
    const params = await parse(CustomerDeleteInput, rawParams);
    const taxId = taxIdOf(params.tax_id);
    if (!(await directory.remove(scopeOf(ctx), taxId)))
      throw new Error('Customer not found');
    return { tax_id: taxId, deleted: true };
  };
}
