import {
  Body,
  Controller,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { data } from '@/shared/http/response';
import {
  DpsNumberingService,
  NumberingCheckUnavailableError,
} from '../application/dps-numbering.service';
import {
  DPS_SEQUENCE_REPOSITORY,
  type IDpsSequenceRepository,
} from '../domain/dps-sequence';

export class ConfirmDpsNumberingDto {
  @ApiProperty({
    required: false,
    type: 'integer',
    format: 'int64',
    minimum: 0,
    maximum: 999_999_999_999_999,
    description:
      'Optional. The last DPS number already used: the next note takes the following one. Omit it to keep the numbering as it is.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999_999_999_999_999)
  lastNumber?: number;
}

/** Checks the DPS numbering of a company with the government, before its first note. */
@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('companies')
@Controller('companies/:id/dps-sequence')
export class DpsNumberingController {
  constructor(
    private readonly numbering: DpsNumberingService,
    @Inject(DPS_SEQUENCE_REPOSITORY)
    private readonly sequences: IDpsSequenceRepository,
  ) {}

  @Post('check')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({
    summary: 'Check the DPS numbering of a company with the government',
    description:
      'Asks the government whether the next DPS numbers (up to 20 in a row) were already used. It only reads: it issues nothing and changes no number.',
  })
  async check(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const environment = executionEnvironment(req.authContext!);
    try {
      const result = await this.numbering.check(id, tenantId, environment);
      return data({
        ...result,
        checkedAt: await this.sequences.numberingCheckedAt(
          id,
          tenantId,
          environment,
        ),
      });
    } catch (error) {
      if (error instanceof NumberingCheckUnavailableError)
        throw new ServiceUnavailableException({
          code: 'DPS_NUMBERING_CHECK_UNAVAILABLE',
          message: error.message,
        });
      throw error;
    }
  }

  @Post('confirm')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({
    summary: 'Confirm the DPS numbering of a company',
    description:
      'Marks the numbering as checked, so the first note is not held back. With lastNumber it first moves the numbering forward (never back).',
  })
  async confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmDpsNumberingDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const environment = executionEnvironment(req.authContext!);
    return data(
      await this.numbering.confirm(id, tenantId, environment, dto.lastNumber),
    );
  }
}
