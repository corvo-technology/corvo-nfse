import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  UnprocessableEntityException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { data } from '@/shared/http/response';
import {
  DPS_SEQUENCE_REPOSITORY,
  type IDpsSequenceRepository,
} from '../domain/dps-sequence';

export class SetDpsSequenceDto {
  @ApiPropertyOptional({
    example: 120,
    description:
      'The number of the last DPS the company already issued in this series (see the DPS number in the last note, PDF or XML). The next note uses the following number.',
  })
  @IsInt()
  @Min(0)
  @Max(999_999_999_999_999)
  lastNumber!: number;
}

/** The DPS numbering of a company: where it stands and, when the company issued elsewhere before, where to continue from. */
@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('companies')
@Controller('companies/:id/dps-sequence')
export class DpsSequenceController {
  constructor(
    @Inject(DPS_SEQUENCE_REPOSITORY)
    private readonly sequences: IDpsSequenceRepository,
  ) {}

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.view')
  @ApiOperation({ summary: 'Get the DPS numbering of a company' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    return data(
      await this.sequences.current(
        id,
        req.authContext!.activeTenantId,
        executionEnvironment(req.authContext!),
      ),
    );
  }

  @Put()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({
    summary: 'Continue the DPS numbering from the last note issued elsewhere',
    description:
      'Use it when the company already issued notes in another system or in the Portal Nacional, so the next DPS does not repeat a number the Receita has (E0014). It only moves forward: a number lower than one already used is refused (DPS_NUMBER_BELOW_CURRENT).',
  })
  async set(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetDpsSequenceDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const environment = executionEnvironment(req.authContext!);
    const now = await this.sequences.current(id, tenantId, environment);
    if (dto.lastNumber < now.lastNumber)
      throw new UnprocessableEntityException({
        code: 'DPS_NUMBER_BELOW_CURRENT',
        message: 'The number is lower than one already used',
      });
    return data(
      await this.sequences.raiseTo(id, tenantId, environment, dto.lastNumber),
    );
  }
}
