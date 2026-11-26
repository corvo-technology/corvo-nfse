import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import {
  CursorPage,
  invalidCursor,
  normalizeLimit,
} from '@/shared/http/pagination';
import { data } from '@/shared/http/response';
import { parseCustomerTaxId } from '@/shared/tax-id';
import { CustomerRegistryPort } from '../domain/customer-registry';
import {
  CustomerDirectory,
  type CustomerScope,
} from '../domain/customer-directory';
import {
  ListCustomersQuery,
  UpdateCustomerDto,
  toCustomerResponse,
} from './customer.dto';

/** The cursor is the offset of the next item. */
function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) return invalidCursor();
  return offset;
}

const notFound = () => new NotFoundException('Customer not found');

/** Customers saved from accepted invoices: the next invoice for the same document needs no name. */
@ApiTags('customers')
@UseGuards(ExecutionEnvironmentGuard)
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly customers: CustomerDirectory,
    private readonly registry: CustomerRegistryPort,
  ) {}

  private scope(req: RequestWithAuthContext): CustomerScope {
    return {
      tenantId: req.authContext!.activeTenantId,
      environment: executionEnvironment(req.authContext!),
    };
  }

  /** A document that is not a valid CPF/CNPJ cannot have been saved. */
  private taxId(raw: string): string {
    const parsed = parseCustomerTaxId(raw);
    if (!parsed) throw notFound();
    return parsed.value;
  }

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'List saved customers, most recently used first' })
  async list(
    @Query() query: ListCustomersQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    const limit = normalizeLimit(query.limit);
    const offset = offsetOf(query.cursor);
    const result = await this.customers.list(
      this.scope(req),
      { search: query.search },
      { limit, offset },
    );
    const next = offset + result.items.length;
    return new CursorPage(result.items.map(toCustomerResponse), {
      limit,
      hasMore: next < result.total,
      nextCursor: next < result.total ? String(next) : null,
    });
  }

  /** Public registry data to prefill a new customer. Null data when it is not a CNPJ or the registry has no answer. */
  @Get('registry/:cnpj')
  @RequirePermission(['nfse.invoices.issue', 'nfe.documents.issue'])
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Look up a CNPJ in the public registry (name, city, state)',
  })
  async registryLookup(@Param('cnpj') cnpj: string) {
    const parsed = parseCustomerTaxId(cnpj);
    if (parsed?.kind !== 'CNPJ') return data(null);
    return data(await this.registry.lookup(parsed.value));
  }

  @Get(':taxId')
  @ApiKeyEndpoint()
  @RequirePermission(['nfse.invoices.view', 'nfe.documents.issue'])
  @ApiOperation({ summary: 'Get a saved customer by CPF or CNPJ' })
  async get(@Param('taxId') taxId: string, @Req() req: RequestWithAuthContext) {
    const customer = await this.customers.find(
      this.scope(req),
      this.taxId(taxId),
    );
    if (!customer) throw notFound();
    return data(toCustomerResponse(customer));
  }

  @Patch(':taxId')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary: 'Correct the name or the email of a saved customer',
  })
  async update(
    @Param('taxId') taxId: string,
    @Body() body: UpdateCustomerDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const customer = await this.customers.update(
      this.scope(req),
      this.taxId(taxId),
      { name: body.name, email: body.email },
    );
    if (!customer) throw notFound();
    return data(toCustomerResponse(customer));
  }

  @Delete(':taxId')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary: 'Forget a saved customer (issued invoices are not changed)',
  })
  async remove(
    @Param('taxId') taxId: string,
    @Req() req: RequestWithAuthContext,
  ) {
    if (!(await this.customers.remove(this.scope(req), this.taxId(taxId))))
      throw notFound();
    return data(null);
  }
}
