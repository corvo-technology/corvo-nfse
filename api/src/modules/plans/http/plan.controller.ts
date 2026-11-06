import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { data } from '@/shared/http/response';
import { cursorScope } from '@/shared/http/keyset-pagination';
import { IsIn, IsOptional } from 'class-validator';
import {
  CursorQuery,
  decodeCursor,
  invalidCursor,
  normalizeLimit,
  paginateItems,
} from '@/shared/http/pagination';
import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PricingService, PriceQuote } from '../application/pricing.service';
import type { BillingCycle, PlanSlug } from '../domain/plan';
import { IPlanRepository } from '../domain/plan.repository';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';

class PlanListQuery extends CursorQuery {
  @IsOptional() @IsIn(['monthly', 'annual']) cycle?: BillingCycle;
}

@Controller('plans')
@PublicRoute()
@ApiTags('plans')
export class PlanController {
  constructor(
    private readonly pricing: PricingService,
    private readonly planRepo: IPlanRepository,
  ) {}

  @Get()
  @ApiCursorResponse()
  list(@Query() options: PlanListQuery) {
    const cycle = options.cycle ?? 'monthly';
    const scope = cursorScope(['plan-quotes', cycle]);
    const cursor = decodeCursor<{ v: number; scope: string; position: number }>(
      options.cursor,
    );
    const quotes = this.pricing.listAllQuotes(cycle);
    if (
      cursor &&
      (cursor.v !== 1 ||
        cursor.scope !== scope ||
        !Number.isInteger(cursor.position) ||
        cursor.position < 0 ||
        cursor.position >= quotes.length)
    )
      invalidCursor();
    const start = cursor ? cursor.position + 1 : 0;
    const limit = normalizeLimit(options.limit);
    const items = quotes.slice(start, start + limit + 1);
    return paginateItems(items, limit, (item) => ({
      v: 1,
      scope,
      position: quotes.findIndex((quote) => quote.slug === item.slug),
    }));
  }

  @Get('recommend')
  recommend(
    @Query('notes', ParseIntPipe) notes: number,
    @Query('cycle') cycle: BillingCycle = 'monthly',
  ) {
    if (cycle !== 'monthly' && cycle !== 'annual')
      throw new BadRequestException('Unsupported billing cycle');
    try {
      const result = this.pricing.recommendForNotes(notes, cycle);
      return data({ notes, cycle, ...result, currency: 'BRL' });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get(':slug')
  async findBySlug(
    @Param('slug') slug: PlanSlug,
    @Query('cycle') cycle: BillingCycle = 'monthly',
  ): Promise<{ data: PriceQuote }> {
    if (cycle !== 'monthly' && cycle !== 'annual')
      throw new BadRequestException('Unsupported billing cycle');
    const plan = await this.planRepo.findBySlug(slug);
    // The no-plan placeholder and retired plans have no public price.
    if (!plan || !this.pricing.isPaidPlan(slug))
      throw new NotFoundException(`Plan ${slug} not found`);
    return data(this.pricing.calculateQuote(slug, cycle));
  }
}
