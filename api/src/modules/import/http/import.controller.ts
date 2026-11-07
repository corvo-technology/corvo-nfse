import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { data } from '@/shared/http/response';
import { ImportIntakeService } from '../application/import-intake.service';
import { ImportEmitService } from '../application/import-emit.service';
import {
  ImportReviewService,
  TEMPLATE_CSV,
} from '../application/import-review.service';
import { DEFAULT_ROWS_PAGE } from '../domain/import';
import { MAX_IMPORT_BYTES } from '../domain/import';
import { ImportFileInvalidError } from '../domain/import-error';
import {
  ListImportRowsQuery,
  StartImportDto,
  UpdateImportRowDto,
  type UploadedImportFile,
} from './import.dto';
import {
  toImportResponse,
  toRowResponse,
  toStartResponse,
} from './import.response';

@ApiTags('imports')
@UseGuards(ExecutionEnvironmentGuard)
@Controller('imports')
export class ImportController {
  constructor(
    private readonly intake: ImportIntakeService,
    private readonly review: ImportReviewService,
    private readonly emitter: ImportEmitService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(202)
  @RequirePermission('nfse.invoices.issue')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }),
  )
  @ApiOperation({
    summary: 'Import invoices from a CSV or Excel spreadsheet',
    description:
      'Accepts a .csv or .xlsx file (up to 2,000 rows and 10 MB). Reading is asynchronous: follow the import by id until it is `ready`.',
  })
  async start(
    @Req() req: RequestWithAuthContext,
    @UploadedFile() file: UploadedImportFile | undefined,
    @Body() body: StartImportDto,
  ) {
    if (!file) throw new ImportFileInvalidError();
    const auth = req.authContext!;
    return data(
      toStartResponse(
        await this.intake.start({
          tenantId: auth.activeTenantId,
          environment: executionEnvironment(auth),
          userId: auth.authUserId,
          fileName: file.originalname,
          bytes: file.buffer,
          companyId: body.companyId,
        }),
      ),
    );
  }

  @Get('template')
  @RequirePermission('nfse.invoices.issue')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="modelo-importacao.csv"')
  @ApiOperation({ summary: 'Download the spreadsheet template' })
  template(): string {
    return TEMPLATE_CSV;
  }

  @Get(':id')
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({ summary: 'Status and counters of an import' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return data(
      toImportResponse(
        await this.review.get(
          auth.activeTenantId,
          executionEnvironment(auth),
          id,
        ),
      ),
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/emit')
  @HttpCode(202)
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary: 'Emit every valid row of the import',
    description:
      'Safe to call twice. After a plan limit stopped the import, call it again once credits are available: only the rows the limit turned away are sent.',
  })
  async emit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return data(
      toImportResponse(
        await this.emitter.emit(
          auth.activeTenantId,
          executionEnvironment(auth),
          id,
        ),
      ),
    );
  }

  @Get(':id/rows')
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary: 'Rows of an import, one page at a time (default 50, at most 200)',
  })
  async rows(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListImportRowsQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    const limit = query.limit ?? DEFAULT_ROWS_PAGE;
    const page = await this.review.listRows(
      auth.activeTenantId,
      executionEnvironment(auth),
      id,
      {
        status: query.status,
        cursor: query.cursor,
        limit,
      },
    );
    return {
      data: page.items.map(toRowResponse),
      pagination: {
        limit,
        hasMore: page.nextCursor !== null,
        nextCursor: page.nextCursor,
      },
    };
  }

  @Patch(':id/rows/:line')
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary:
      'Correct one row and check it again (only while the import is ready)',
  })
  async updateRow(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('line', ParseIntPipe) line: number,
    @Body() body: UpdateImportRowDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return data(
      toRowResponse(
        await this.review.updateRow(
          auth.activeTenantId,
          executionEnvironment(auth),
          id,
          line,
          body.item,
        ),
      ),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({ summary: 'Discard an import that has not been emitted' })
  async discard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<void> {
    const auth = req.authContext!;
    await this.review.discard(
      auth.activeTenantId,
      executionEnvironment(auth),
      id,
    );
  }

  @Get(':id/errors.csv')
  @RequirePermission('nfse.invoices.issue')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="erros-importacao.csv"')
  @ApiOperation({ summary: 'CSV with the rows that need attention, streamed' })
  errors(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ): StreamableFile {
    const auth = req.authContext!;
    return new StreamableFile(
      Readable.from(
        this.review.errorsCsv(
          auth.activeTenantId,
          executionEnvironment(auth),
          id,
        ),
      ),
    );
  }
}
