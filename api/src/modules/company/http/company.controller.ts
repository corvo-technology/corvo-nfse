import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { data } from '@/shared/http/response';
import type { DataEnvelope } from '@/shared/http/response';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import {
  Controller,
  UseGuards,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Inject,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import type { AuthContext } from '@/modules/auth/auth-context';
import { todayInEstablishmentTimezone } from '@/shared/dates/date-time';
import { CompanyService } from '../application/company.service';
import type { CurrentCompanyRegime } from '../application/company.service';
import { CompanyFiscalProfileService } from '../application/company-fiscal-profile.service';
import { CompanyServiceTaxProfileService } from '../application/company-service-tax-profile.service';
import { ICompanyCertificateReader } from '../domain/i-company-certificate-reader';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  ListCompaniesQuery,
  UpsertFiscalProfileDto,
  CreateServiceTaxProfileDto,
  UpdateServiceTaxProfileDto,
  ListServiceTaxProfilesQuery,
} from './company.dto';
import type {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
} from '../domain/company';
import type { CompanyFiscalProfile } from '../domain/fiscal-profile';
import type { NewFiscalProfile } from '../domain/fiscal-profile.repository';
import type { CompanyServiceTaxProfile } from '../domain/service-tax-profile';
import type { NewServiceTaxProfile } from '../domain/service-tax-profile.repository';

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
  if (dto.sendMunicipalReg !== undefined)
    result.sendMunicipalReg = dto.sendMunicipalReg;
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
  if (dto.sendMunicipalReg !== undefined)
    input.sendMunicipalReg = dto.sendMunicipalReg;
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

/** PUT semantics: an open vigência equal to the desired state is a no-op. */
function fiscalProfileMatches(
  profile: CompanyFiscalProfile,
  desired: NewFiscalProfile,
): boolean {
  return (
    profile.validFrom === desired.validFrom &&
    profile.taxRegime === desired.taxRegime &&
    profile.simpleNational === desired.simpleNational &&
    profile.specialTaxRegime === desired.specialTaxRegime &&
    profile.ibsCbsRegularOption === desired.ibsCbsRegularOption &&
    profile.ibsCbsRegularFrom === desired.ibsCbsRegularFrom &&
    profile.simplesIssRate === desired.simplesIssRate &&
    profile.reviewStatus === desired.reviewStatus
  );
}

/** Flattens the validated DTO rates into a plain percent-string record. */
function withholdingRatesFromDto(
  rates: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(rates ?? {})) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function mergeServiceTaxProfile(
  existing: CompanyServiceTaxProfile,
  dto: UpdateServiceTaxProfileDto,
): NewServiceTaxProfile {
  const keep = <T>(patched: T | undefined, current: T): T =>
    patched !== undefined ? patched : current;
  return {
    name: keep(dto.name, existing.name),
    serviceCode: keep(dto.serviceCode, existing.serviceCode),
    municipalServiceCode: keep(
      dto.municipalServiceCode,
      existing.municipalServiceCode,
    ),
    nbsCode: keep(dto.nbsCode, existing.nbsCode),
    cst: keep(dto.cst, existing.cst),
    classCode: keep(dto.classCode, existing.classCode),
    operationIndicator: keep(
      dto.operationIndicator,
      existing.operationIndicator,
    ),
    operationNature: keep(dto.operationNature, existing.operationNature),
    regimeApplicability:
      dto.regimeApplicability !== undefined
        ? [...dto.regimeApplicability]
        : existing.regimeApplicability,
    incidenceMunicipalityCode: keep(
      dto.incidenceMunicipalityCode,
      existing.incidenceMunicipalityCode,
    ),
    issTaxation: keep(dto.issTaxation, existing.issTaxation),
    issRate: keep(dto.issRate, existing.issRate),
    issWithholdingDefault: keep(
      dto.issWithholdingDefault,
      existing.issWithholdingDefault,
    ),
    withholdingPolicy: keep(dto.withholdingPolicy, existing.withholdingPolicy),
    withholdingRates:
      dto.withholdingRates !== undefined
        ? withholdingRatesFromDto(dto.withholdingRates)
        : { ...existing.withholdingRates },
    effectiveFrom: keep(dto.effectiveFrom, existing.effectiveFrom),
    effectiveUntil: keep(dto.effectiveUntil, existing.effectiveUntil),
    classificationSource: keep(
      dto.classificationSource,
      existing.classificationSource,
    ),
    reviewStatus: existing.reviewStatus,
    catalogVersion: keep(dto.catalogVersion, existing.catalogVersion),
  };
}

function serviceTaxProfileInputFromDto(
  dto: CreateServiceTaxProfileDto,
): NewServiceTaxProfile {
  return {
    name: dto.name,
    serviceCode: dto.serviceCode,
    municipalServiceCode: dto.municipalServiceCode ?? null,
    nbsCode: dto.nbsCode ?? null,
    cst: dto.cst ?? null,
    classCode: dto.classCode ?? null,
    operationIndicator: dto.operationIndicator ?? null,
    operationNature: dto.operationNature ?? 'SERVICE',
    regimeApplicability: [...(dto.regimeApplicability ?? [])],
    incidenceMunicipalityCode: dto.incidenceMunicipalityCode ?? null,
    issTaxation: dto.issTaxation ?? null,
    issRate: dto.issRate ?? null,
    issWithholdingDefault: dto.issWithholdingDefault ?? false,
    withholdingPolicy: dto.withholdingPolicy ?? 'UNKNOWN',
    withholdingRates: withholdingRatesFromDto(dto.withholdingRates),
    effectiveFrom: dto.effectiveFrom,
    effectiveUntil: dto.effectiveUntil ?? null,
    classificationSource: dto.classificationSource ?? 'manual',
    reviewStatus: 'unreviewed',
    catalogVersion: dto.catalogVersion ?? null,
  };
}

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('companies')
@Controller('companies')
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    @Inject(ICompanyCertificateReader)
    private readonly certReader: ICompanyCertificateReader,
    private readonly fiscalProfiles: CompanyFiscalProfileService,
    private readonly serviceTaxProfiles: CompanyServiceTaxProfileService,
  ) {}

  private requireAuthContext(req: RequestWithAuthContext): AuthContext {
    const context = req.authContext;
    if (!context)
      throw new UnauthorizedException('Authentication context is required');
    return context;
  }

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
      req.authContext!.authUserId,
    );
    const regime = await this.companyService.currentRegime(
      company.id,
      tenantId,
    );
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
    await this.companyService.update(
      id,
      dtoToUpdateInput(dto),
      tenantId,
      env,
      req.authContext!.authUserId,
    );
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

  @Get(':id/fiscal-profile')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.view')
  @ApiOperation({ summary: 'List the fiscal profile history of the company' })
  async listFiscalProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<CompanyFiscalProfile[]>> {
    const context = this.requireAuthContext(req);
    await this.companyService.findById(
      id,
      context.activeTenantId,
      executionEnvironment(context),
    );
    return data(await this.fiscalProfiles.list(id, context.activeTenantId));
  }

  @Put(':id/fiscal-profile')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({
    summary:
      'Create a fiscal profile validity period (idempotent for an identical desired state)',
  })
  async upsertFiscalProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertFiscalProfileDto,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<CompanyFiscalProfile>> {
    const context = this.requireAuthContext(req);
    const tenantId = context.activeTenantId;
    await this.companyService.findById(
      id,
      tenantId,
      executionEnvironment(context),
    );
    const confirmed = dto.confirm === true;
    const desired: NewFiscalProfile = {
      taxRegime: dto.taxRegime,
      simpleNational: dto.simpleNational ?? false,
      specialTaxRegime: dto.specialTaxRegime ?? null,
      ibsCbsRegularOption: dto.ibsCbsRegularOption ?? false,
      ibsCbsRegularFrom: dto.ibsCbsRegularFrom ?? null,
      simplesIssRate: dto.simplesIssRate ?? null,
      validFrom: dto.validFrom ?? todayInEstablishmentTimezone(),
      source: 'company_api',
      reviewStatus: confirmed ? 'approved' : 'unreviewed',
      reviewedBy: confirmed ? context.authUserId : null,
    };
    const open = await this.fiscalProfiles.current(id, tenantId);
    if (open !== null && fiscalProfileMatches(open, desired)) {
      return data(open);
    }
    return data(await this.fiscalProfiles.record(id, tenantId, desired));
  }

  @Post(':id/fiscal-profile/:profileId/approve')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({ summary: 'Approve a fiscal profile of the company' })
  async approveFiscalProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<CompanyFiscalProfile>> {
    const context = this.requireAuthContext(req);
    const tenantId = context.activeTenantId;
    await this.companyService.findById(
      id,
      tenantId,
      executionEnvironment(context),
    );
    return data(
      await this.fiscalProfiles.approve(
        id,
        tenantId,
        profileId,
        context.authUserId,
      ),
    );
  }

  @Get(':id/service-tax-profiles')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.view')
  @ApiOperation({
    summary: 'List service tax profiles effective on the informed date',
  })
  async listServiceTaxProfiles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListServiceTaxProfilesQuery,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<CompanyServiceTaxProfile[]>> {
    const context = this.requireAuthContext(req);
    const tenantId = context.activeTenantId;
    await this.companyService.findById(
      id,
      tenantId,
      executionEnvironment(context),
    );
    return data(
      await this.serviceTaxProfiles.list(
        id,
        tenantId,
        query.date ?? todayInEstablishmentTimezone(),
      ),
    );
  }

  @Post(':id/service-tax-profiles')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({
    summary: 'Create a service tax profile in the company catalog',
  })
  async createServiceTaxProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateServiceTaxProfileDto,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<CompanyServiceTaxProfile>> {
    const context = this.requireAuthContext(req);
    const tenantId = context.activeTenantId;
    await this.companyService.findById(
      id,
      tenantId,
      executionEnvironment(context),
    );
    return data(
      await this.serviceTaxProfiles.upsert(
        id,
        tenantId,
        null,
        serviceTaxProfileInputFromDto(dto),
      ),
    );
  }

  @Patch(':id/service-tax-profiles/:serviceId')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({
    summary: 'Update a service tax profile of the company catalog',
  })
  async updateServiceTaxProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body() dto: UpdateServiceTaxProfileDto,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<CompanyServiceTaxProfile>> {
    const context = this.requireAuthContext(req);
    const tenantId = context.activeTenantId;
    await this.companyService.findById(
      id,
      tenantId,
      executionEnvironment(context),
    );
    const existing = await this.serviceTaxProfiles.findById(
      serviceId,
      id,
      tenantId,
    );
    if (!existing) throw new NotFoundException('Service tax profile not found');
    return data(
      await this.serviceTaxProfiles.upsert(
        id,
        tenantId,
        serviceId,
        mergeServiceTaxProfile(existing, dto),
      ),
    );
  }

  @Post(':id/service-tax-profiles/:serviceId/approve')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({ summary: 'Approve the saved service tax classification for this company' })
  async approveServiceTaxProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<CompanyServiceTaxProfile>> {
    const context = this.requireAuthContext(req);
    await this.companyService.findById(id, context.activeTenantId, executionEnvironment(context));
    return data(await this.serviceTaxProfiles.approve(id, context.activeTenantId, serviceId));
  }

  @Delete(':id/service-tax-profiles/:serviceId')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.companies.manage')
  @ApiOperation({
    summary: 'Delete an expired, not yet approved service tax profile',
  })
  async deleteServiceTaxProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<null>> {
    const context = this.requireAuthContext(req);
    const tenantId = context.activeTenantId;
    await this.companyService.findById(
      id,
      tenantId,
      executionEnvironment(context),
    );
    await this.serviceTaxProfiles.delete(
      id,
      tenantId,
      serviceId,
      todayInEstablishmentTimezone(),
    );
    return data(null);
  }
}
