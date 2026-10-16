import { randomUUID } from 'crypto';

// ─── Value types ────────────────────────────────────────────────────────────

export type CertificateStatus = 'active' | 'expired' | 'revoked';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface CertificateProps {
  id: string;
  companyId: string;
  serialNumber: string;
  issuer: string;
  subject: string;
  fingerprint: string;
  validFrom: Date;
  validUntil: Date;
  status: CertificateStatus;
  encryptedBlob: Buffer;
  encryptedDek: Buffer;
  dekIv: Buffer;
  createdAt: Date;
  deletedAt?: Date;
}

// ─── Metadata (excludes blob/dek/iv) ────────────────────────────────────────

export interface CertificateMetadata {
  id: string;
  companyId: string;
  serialNumber: string;
  issuer: string;
  subject: string;
  fingerprint: string;
  validFrom: Date;
  validUntil: Date;
  status: CertificateStatus;
  createdAt: Date;
}

// ─── Decrypted bundle ───────────────────────────────────────────────────────

export interface DecryptedCertificate {
  p12Buffer: Buffer;
  metadata: CertificateMetadata;
}

// ─── Aggregate ──────────────────────────────────────────────────────────────

export interface ParsedP12 {
  /** CNPJ the certificate was issued to, when it can be read reliably; null for e-CPF or unknown layouts. */
  taxId?: string | null;
  serialNumber: string;
  issuer: string;
  subject: string;
  fingerprint: string;
  validFrom: Date;
  validUntil: Date;
  p12Buffer: Buffer;
}

export class Certificate {
  private constructor(private readonly props: CertificateProps) {}

  static createFromP12(
    parsedP12: ParsedP12,
    encryptedBlob: Buffer,
    encryptedDek: Buffer,
    dekIv: Buffer,
    companyId: string,
  ): Certificate {
    return new Certificate({
      id: randomUUID(),
      companyId,
      serialNumber: parsedP12.serialNumber,
      issuer: parsedP12.issuer,
      subject: parsedP12.subject,
      fingerprint: parsedP12.fingerprint,
      validFrom: parsedP12.validFrom,
      validUntil: parsedP12.validUntil,
      status: 'active',
      encryptedBlob,
      encryptedDek,
      dekIv,
      createdAt: new Date(),
    });
  }

  static reconstitute(props: CertificateProps): Certificate {
    return new Certificate(props);
  }

  get id(): string {
    return this.props.id;
  }

  get companyId(): string {
    return this.props.companyId;
  }

  get serialNumber(): string {
    return this.props.serialNumber;
  }

  get issuer(): string {
    return this.props.issuer;
  }

  get subject(): string {
    return this.props.subject;
  }

  get fingerprint(): string {
    return this.props.fingerprint;
  }

  get validFrom(): Date {
    return this.props.validFrom;
  }

  get validUntil(): Date {
    return this.props.validUntil;
  }

  get status(): CertificateStatus {
    return this.props.status;
  }

  get encryptedBlob(): Buffer {
    return this.props.encryptedBlob;
  }

  get encryptedDek(): Buffer {
    return this.props.encryptedDek;
  }

  get dekIv(): Buffer {
    return this.props.dekIv;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get deletedAt(): Date | undefined {
    return this.props.deletedAt;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== undefined;
  }

  isValid(): boolean {
    if (this.props.status !== 'active') return false;
    if (this.props.deletedAt !== undefined) return false;
    return this.props.validUntil > new Date();
  }

  markExpired(): void {
    if (this.props.status !== 'active') return;
    this.props.status = 'expired';
  }

  markRevoked(): void {
    if (this.props.status === 'revoked') return;
    this.props.status = 'revoked';
  }

  markDeleted(): void {
    this.props.deletedAt = new Date();
  }

  toSnapshot(): CertificateProps {
    return { ...this.props };
  }

  toMetadata(): CertificateMetadata {
    return {
      id: this.props.id,
      companyId: this.props.companyId,
      serialNumber: this.props.serialNumber,
      issuer: this.props.issuer,
      subject: this.props.subject,
      fingerprint: this.props.fingerprint,
      validFrom: this.props.validFrom,
      validUntil: this.props.validUntil,
      status: this.props.status,
      createdAt: this.props.createdAt,
    };
  }
}
