import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { randomUUID } from 'crypto';
import { normalizeTaxID } from '@/shared/tax-id';

// ─── Value types ────────────────────────────────────────────────────────────

export type CompanyEnvironment = ExecutionEnvironment;
export type CompanyStatus = 'pending_setup' | 'ready' | 'blocked';
export type TaxRegime =
  | 'MEI'
  | 'Simples Nacional'
  | 'Lucro Presumido'
  | 'Lucro Real';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface CompanyProps {
  id: string;
  tenantId: string;
  legalName: string;
  tradeName?: string;
  taxId: string;
  municipalReg?: string;
  /** Send the municipal registration (IM) in the DPS. Off by default: the Receita rejects it (E0120) when the city has no complementary data for the provider. */
  sendMunicipalReg?: boolean;
  municipalityCode?: string;
  defaultServiceCode?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressDistrict?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  fiscalSchemaVersion: string;
  environment: CompanyEnvironment;
  status: CompanyStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ─── Input types ─────────────────────────────────────────────────────────────

/**
 * Legacy-shaped fiscal regime fields accepted by the HTTP API for backward
 * compatibility. The {@link Company} aggregate no longer stores these — they
 * are routed to the company's fiscal profile (see `CompanyFiscalProfile`).
 */
export interface CompanyRegimeInput {
  taxRegime: TaxRegime;
  simpleNational?: boolean;
  specialRegime?: string;
}

export type CreateCompanyInput = {
  legalName: string;
  taxId: string;
  taxRegime: TaxRegime;
  tradeName?: string;
  municipalReg?: string;
  sendMunicipalReg?: boolean;
  municipalityCode?: string;
  defaultServiceCode?: string;
  simpleNational?: boolean;
  specialRegime?: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  environment?: CompanyEnvironment;
};

export type UpdateCompanyInput = {
  legalName?: string;
  tradeName?: string;
  taxId?: string;
  municipalReg?: string | null;
  sendMunicipalReg?: boolean;
  municipalityCode?: string;
  defaultServiceCode?: string | null;
  taxRegime?: TaxRegime;
  simpleNational?: boolean;
  specialRegime?: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  environment?: CompanyEnvironment;
};

// ─── Aggregate ─────────────────────────────────────────────────────────────

export class Company {
  private constructor(private readonly props: CompanyProps) {}

  static create(input: CreateCompanyInput, tenantId: string): Company {
    if (!input.legalName?.trim()) {
      throw new Error('Company.legalName is required');
    }
    if (!input.taxId?.trim()) {
      throw new Error('Company.taxId is required');
    }

    const now = new Date();
    const normalizedTaxId = normalizeTaxID(input.taxId) ?? input.taxId.trim();
    return new Company({
      id: randomUUID(),
      tenantId,
      legalName: input.legalName.trim(),
      tradeName: input.tradeName?.trim(),
      taxId: normalizedTaxId,
      municipalReg: input.municipalReg?.trim(),
      sendMunicipalReg: input.sendMunicipalReg ?? false,
      municipalityCode: input.municipalityCode?.trim(),
      defaultServiceCode: input.defaultServiceCode?.trim(),
      addressStreet: input.address?.street?.trim(),
      addressNumber: input.address?.number?.trim(),
      addressComplement: input.address?.complement?.trim(),
      addressDistrict: input.address?.district?.trim(),
      addressCity: input.address?.city?.trim(),
      addressState: input.address?.state?.trim(),
      addressZip: input.address?.zip?.trim(),
      fiscalSchemaVersion: 'v2_02',
      environment: input.environment ?? 'test',
      status: 'pending_setup',
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: CompanyProps): Company {
    return new Company(props);
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get legalName(): string {
    return this.props.legalName;
  }

  get tradeName(): string | undefined {
    return this.props.tradeName;
  }

  get taxId(): string {
    return this.props.taxId;
  }

  get municipalReg(): string | undefined {
    return this.props.municipalReg;
  }

  get sendMunicipalReg(): boolean {
    return this.props.sendMunicipalReg ?? false;
  }

  /** The IM that goes into the DPS: only when the company opted in and has one. */
  get municipalRegForDps(): string | undefined {
    return this.sendMunicipalReg ? this.props.municipalReg : undefined;
  }

  get municipalityCode(): string | undefined {
    return this.props.municipalityCode;
  }

  get defaultServiceCode(): string | undefined {
    return this.props.defaultServiceCode;
  }

  get addressStreet(): string | undefined {
    return this.props.addressStreet;
  }

  get addressNumber(): string | undefined {
    return this.props.addressNumber;
  }

  get addressComplement(): string | undefined {
    return this.props.addressComplement;
  }

  get addressDistrict(): string | undefined {
    return this.props.addressDistrict;
  }

  get addressCity(): string | undefined {
    return this.props.addressCity;
  }

  get addressState(): string | undefined {
    return this.props.addressState;
  }

  get addressZip(): string | undefined {
    return this.props.addressZip;
  }

  get fiscalSchemaVersion(): string {
    return this.props.fiscalSchemaVersion;
  }

  get environment(): CompanyEnvironment {
    return this.props.environment;
  }

  get status(): CompanyStatus {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get deletedAt(): Date | undefined {
    return this.props.deletedAt;
  }

  get isReady(): boolean {
    return this.props.status === 'ready';
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== undefined;
  }

  getSetupGaps(): string[] {
    const gaps: string[] = [];
    if (!/^\d{7}$/.test(this.props.municipalityCode ?? ''))
      gaps.push('municipality_code');
    // The municipal registration is optional: the DPS only carries it when the company has one.
    // Certificate gap is determined externally (ICompanyCertificateReader).
    // This method only returns gaps the domain can determine without external I/O.
    return gaps;
  }

  /** @deprecated use getSetupGaps() */
  getMissingForReady(): string[] {
    return this.getSetupGaps();
  }

  recomputeStatus(hasActiveCertificate: boolean): void {
    if (this.props.status === 'blocked') return;
    const gaps = this.getSetupGaps();
    if (gaps.length === 0 && hasActiveCertificate) {
      this.props.status = 'ready';
    } else {
      this.props.status = 'pending_setup';
    }
    this.props.updatedAt = new Date();
  }

  getSetupGapsWithCert(hasActiveCertificate: boolean): string[] {
    const gaps = this.getSetupGaps();
    if (!hasActiveCertificate) {
      gaps.push('certificate');
    }
    return gaps;
  }

  markReady(): void {
    if (this.props.status === 'blocked') {
      throw new Error('Cannot mark a blocked company as ready');
    }
    const missing = this.getSetupGaps();
    if (missing.length > 0) {
      throw new Error(
        `Cannot mark company as ready. Missing: ${missing.join(', ')}`,
      );
    }
    this.props.status = 'ready';
    this.props.updatedAt = new Date();
  }

  markBlocked(): void {
    this.props.status = 'blocked';
    this.props.updatedAt = new Date();
  }

  update(input: UpdateCompanyInput): void {
    if (input.legalName !== undefined)
      this.props.legalName = input.legalName.trim();
    if (input.tradeName !== undefined)
      this.props.tradeName = input.tradeName?.trim();
    if (input.taxId !== undefined) {
      const normalized = normalizeTaxID(input.taxId);
      if (!normalized) {
        throw new Error('Company.taxId is invalid');
      }
      this.props.taxId = normalized;
    }
    if (input.sendMunicipalReg !== undefined)
      this.props.sendMunicipalReg = input.sendMunicipalReg;
    if (input.municipalReg !== undefined) {
      if (input.municipalReg === null) {
        this.props.municipalReg = undefined;
        // Nothing left to send.
        this.props.sendMunicipalReg = false;
      } else {
        const trimmed = input.municipalReg.trim();
        if (trimmed === '') {
          throw new Error('Company.municipalReg cannot be blank');
        }
        this.props.municipalReg = trimmed;
      }
    }
    if (input.municipalityCode !== undefined)
      this.props.municipalityCode = input.municipalityCode?.trim();
    if (input.defaultServiceCode !== undefined)
      this.props.defaultServiceCode =
        input.defaultServiceCode === null
          ? undefined
          : input.defaultServiceCode.trim();
    if (input.address !== undefined) {
      if (input.address === null) {
        // Clear all address fields
        this.props.addressStreet = undefined;
        this.props.addressNumber = undefined;
        this.props.addressComplement = undefined;
        this.props.addressDistrict = undefined;
        this.props.addressCity = undefined;
        this.props.addressState = undefined;
        this.props.addressZip = undefined;
      } else {
        if (input.address.street !== undefined)
          this.props.addressStreet = input.address.street?.trim();
        if (input.address.number !== undefined)
          this.props.addressNumber = input.address.number?.trim();
        if (input.address.complement !== undefined)
          this.props.addressComplement = input.address.complement?.trim();
        if (input.address.district !== undefined)
          this.props.addressDistrict = input.address.district?.trim();
        if (input.address.city !== undefined)
          this.props.addressCity = input.address.city?.trim();
        if (input.address.state !== undefined)
          this.props.addressState = input.address.state?.trim();
        if (input.address.zip !== undefined) {
          if (input.address.zip === null) {
            this.props.addressZip = undefined;
          } else {
            const trimmed = input.address.zip.trim();
            if (trimmed === '') {
              throw new Error('Company.addressZip cannot be blank');
            }
            this.props.addressZip = trimmed;
          }
        }
      }
    }
    if (
      input.environment !== undefined &&
      input.environment !== this.props.environment
    )
      throw new Error('Company environment is immutable');
    if (this.props.status === 'ready' && this.getSetupGaps().length > 0)
      this.props.status = 'pending_setup';
    this.props.updatedAt = new Date();
  }

  markDeleted(): void {
    this.props.deletedAt = new Date();
    this.props.updatedAt = new Date();
  }

  toSnapshot(): CompanyProps {
    return { ...this.props };
  }
}
