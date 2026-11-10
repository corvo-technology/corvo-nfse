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
    'Correct the name or the email of a saved customer. Applies to the next invoices only; invoices already issued do not change. Send email as null to remove it.',
  inputSchema: {
    type: 'object',
    properties: {
      ...TAX_ID,
      name: { type: 'string', maxLength: 300 },
      email: { type: ['string', 'null'] },
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
    if (params.name === undefined && params.email === undefined)
      throw new Error('Invalid input: send name or email to change');
    const customer = await directory.update(
      scopeOf(ctx),
      taxIdOf(params.tax_id),
      { name: params.name?.trim(), email: params.email },
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
