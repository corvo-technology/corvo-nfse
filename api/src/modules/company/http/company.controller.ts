import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { data } from '@/shared/http/response';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import {
  Controller,
  UseGuards,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { CompanyService } from '../application/company.service';
import type { CurrentCompanyRegime } from '../application/company.service';
import { ICompanyCertificateReader } from '../domain/i-company-certificate-reader';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  ListCompaniesQuery,
} from './company.dto';
import type {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
} from '../domain/company';

function toView(
  company: Company,
  hasActiveCert: boolean,
  regime: CurrentCompanyRegime | null,
) {
  const snapshot = company.toSnapshot();
  return {
    ...snapshot,
    setupGaps: company.getSetupGapsWithCert(hasActiveCert),
    taxRegime: regime?.taxRegime ?? null,
    simpleNational: regime?.simpleNational ?? false,
    specialRegime: regime?.specialRegime ?? null,
  };
}

function dtoToCreateInput(dto: CreateCompanyDto): CreateCompanyInput {
  const result: CreateCompanyInput = {
    legalName: dto.legalName,
    taxId: dto.taxId,
    taxRegime: dto.taxRegime,
  };
  if (dto.tradeName !== undefined) result.tradeName = dto.tradeName;
  if (dto.municipalReg !== undefined)
    result.municipalReg =
      dto.municipalReg === null ? undefined : dto.municipalReg;
  if (dto.municipalityCode !== undefined)
    result.municipalityCode = dto.municipalityCode;
  if (dto.defaultServiceCode !== undefined)
    result.defaultServiceCode = dto.defaultServiceCode;
  if (dto.simpleNational !== undefined)
    result.simpleNational = dto.simpleNational;
  if (dto.specialRegime !== undefined) result.specialRegime = dto.specialRegime;
  if (dto.address != null) {
    const a = dto.address;
    result.address = {
      street: a.street,
      number: a.number,
      complement: a.complement,
      district: a.district,
      city: a.city,
      state: a.state,
      zip: a.zip,
    };
  }
  return result;
}

function dtoToUpdateInput(dto: UpdateCompanyDto): UpdateCompanyInput {
  const input: UpdateCompanyInput = {};
  if (dto.legalName !== undefined) input.legalName = dto.legalName;
  if (dto.tradeName !== undefined) input.tradeName = dto.tradeName;
  if (dto.taxId !== undefined) input.taxId = dto.taxId;
  // null means clear, undefined means no change
  if ('municipalReg' in dto) input.municipalReg = dto.municipalReg;
  if (dto.municipalityCode !== undefined)
    input.municipalityCode = dto.municipalityCode;
  if (dto.taxRegime !== undefined) input.taxRegime = dto.taxRegime;
  if (dto.defaultServiceCode !== undefined)
    input.defaultServiceCode = dto.defaultServiceCode;
  if (dto.simpleNational !== undefined)
    input.simpleNational = dto.simpleNational;
  if (dto.specialRegime !== undefined) input.specialRegime = dto.specialRegime;
  if (dto.address !== undefined) {
    if (dto.address === null) {
      input.address = null;
    } else if (dto.address != null) {
      const a = dto.address;
      input.address = {
        street: a.street,
        number: a.number,
        complement: a.complement,
        district: a.district,
        city: a.city,
        state: a.state,
        zip: a.zip,
      };
    }
  }
  return input;
}

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('companies')
@Controller('companies')
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    @Inject(ICompanyCertificateReader)
    private readonly certReader: ICompanyCertificateReader,
  ) {}

  @Post()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({ summary: 'Create a new NFS-e company' })
  async create(
    @Body() dto: CreateCompanyDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const company = await this.companyService.create(
      dtoToCreateInput(dto),
      tenantId,
      executionEnvironment(req.authContext!),
    );
    const regime = await this.companyService.currentRegime(company.id, tenantId);
    return data(toView(company, false, regime));
  }

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.view')
  @ApiOperation({ summary: 'List companies for the current tenant' })
  @ApiCursorResponse()
  async list(
    @Req() req: RequestWithAuthContext,
    @Query() query: ListCompaniesQuery,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const env = executionEnvironment(req.authContext!);
    const page = await this.companyService.listPage(tenantId, query, env);
    const companies = page.data;
    // Fetch setup gaps for all companies in one batch
    const certStatus = await this.certReader.activeCertificateCounts(
      companies.map((c) => c.id),
      env,
      tenantId,
    );
    const regimes = await this.companyService.currentRegimesByCompanyIds(
      companies.map((c) => c.id),
      tenantId,
    );
    return page.map((c) =>
      toView(c, certStatus.get(c.id) ?? false, regimes.get(c.id) ?? null),
    );
  }

  @Get(':id')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.view')
  @ApiOperation({ summary: 'Get a company by ID' })
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const env = executionEnvironment(req.authContext!);
    const company = await this.companyService.findById(id, tenantId, env);
    const hasCert = await this.certReader.hasActiveCertificate(
      id,
      env,
      tenantId,
    );
    const regime = await this.companyService.currentRegime(id, tenantId);
    return data(toView(company, hasCert, regime));
  }

  @Patch(':id')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({ summary: 'Update a company' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCompanyDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const env = executionEnvironment(req.authContext!);
    await this.companyService.update(id, dtoToUpdateInput(dto), tenantId, env);
    const hasCert = await this.certReader.hasActiveCertificate(
      id,
      env,
      tenantId,
    );
    const refreshed = await this.companyService.syncSetupStatus(
      id,
      tenantId,
      hasCert,
      env,
    );
    const regime = await this.companyService.currentRegime(id, tenantId);
    return data(toView(refreshed, hasCert, regime));
  }

  @Delete(':id')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({ summary: 'Delete a company (soft delete)' })
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    await this.companyService.delete(
      id,
      tenantId,
      executionEnvironment(req.authContext!),
    );
    return data(null);
  }
}
