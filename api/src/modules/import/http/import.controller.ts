import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
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
import { MAX_IMPORT_BYTES } from '../domain/import';
import { ImportFileInvalidError } from '../domain/import-error';
import { StartImportDto, type UploadedImportFile } from './import.dto';

@ApiTags('imports')
@UseGuards(ExecutionEnvironmentGuard)
@Controller('imports')
export class ImportController {
  constructor(private readonly intake: ImportIntakeService) {}

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
      await this.intake.start({
        tenantId: auth.activeTenantId,
        environment: executionEnvironment(auth),
        userId: auth.authUserId,
        fileName: file.originalname,
        bytes: file.buffer,
        companyId: body.companyId,
      }),
    );
  }
}
