import { randomUUID } from 'node:crypto';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  InvalidNfeTransitionError,
  NfeNumberAlreadyAssignedError,
} from './errors';
import type { NfeItem } from './nfe-item';
import { NFE_VALID_TRANSITIONS, type NfeStatus } from './nfe-status';

export interface NfeAddress {
  street: string;
  number: string;
  complement: string | null;
  district: string;
  zip: string;
  /** IBGE code of the municipality (7 digits). */
  cityCode: string;
  city: string;
  state: string;
}

export interface NfeRecipient {
  /** CPF (11) or CNPJ (14, alphanumeric allowed), digits and letters only. */
  taxId: string;
  name: string;
  /** 1 contributor, 2 exempt, 9 non-contributor. */
  indIeDest: 1 | 2 | 9;
  stateRegistration: string | null;
  email: string | null;
  address: NfeAddress;
}

/** Totals as decimal strings with 2 places (what the `vProd`..`vNF` tags carry). */
export interface NfeTotalsSnapshot {
  vProd: string;
  vDesc: string;
  vFrete: string;
  vSeg: string;
  vOutro: string;
  vNF: string;
}

export interface NfePayment {
  tPag: string;
  amount: string;
}

export interface NfePaymentSnapshot {
  payments: NfePayment[];
  /** `vTroco`. */
  change: string;
}

export type NfeErrorType = 'communication' | 'validation' | 'configuration';

export interface NfeDocumentProps {
  id: string;
  tenantId: string;
  companyId: string;
  environment: ExecutionEnvironment;
  /** 55 = NF-e, 65 = NFC-e. */
  model: 55 | 65;
  series: number | null;
  number: number | null;
  accessKey: string | null;
  cNf: string | null;
  tpEmis: number;
  issuedAt: Date | null;
  natOp: string;
  idDest: number;
  indFinal: number;
  indPres: number;
  finNfe: number;
  tpImp: number;
  status: NfeStatus;
  cStat: string | null;
  xMotivo: string | null;
  protocol: string | null;
  authorizedAt: Date | null;
  recipient: NfeRecipient;
  items: NfeItem[];
  totals: NfeTotalsSnapshot;
  payment: NfePaymentSnapshot;
  transport: { modFrete: 9 };
  additionalInfo: string | null;
  externalId: string | null;
  idempotencyKey: string;
  requestHash: string;
  signedXml: string | null;
  protNfeXml: string | null;
  attempt: number;
  authority: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorType: NfeErrorType | null;
  nextCheckAt: Date | null;
  reconcileAttempts: number;
  sendEmail: boolean;
  documentsReadyAt: Date | null;
  emailStatus: string | null;
  emailSentAt: Date | null;
  cancelReason: string | null;
  cancelRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NfeDocumentSnapshot = Readonly<NfeDocumentProps>;

export interface CreateNfeDocumentParams {
  id?: string;
  tenantId: string;
  companyId: string;
  environment: ExecutionEnvironment;
  /** 55 (NF-e, the default) or 65 (NFC-e). */
  model?: 55 | 65;
  natOp: string;
  idDest: number;
  indFinal: number;
  indPres: number;
  finNfe: number;
  tpImp: number;
  recipient: NfeRecipient;
  items: NfeItem[];
  totals: NfeTotalsSnapshot;
  payment: NfePaymentSnapshot;
  additionalInfo?: string | null;
  externalId?: string | null;
  sendEmail?: boolean;
  idempotencyKey: string;
  requestHash: string;
}

/** One row of `nfe_document_history`. */
export interface NfeHistoryEntry {
  tenantId: string;
  documentId: string;
  fromStatus: NfeStatus | null;
  toStatus: NfeStatus;
  accessKey: string | null;
  attempt: number;
  cStat: string | null;
  xMotivo: string | null;
}

export interface NfeLastError {
  type: NfeErrorType;
  code: string;
  message: string;
}

/** The body of the document: what the customer sends and may correct before resubmitting. */
export interface NfeContent {
  natOp: string;
  idDest: number;
  indFinal: number;
  indPres: number;
  finNfe: number;
  tpImp: number;
  recipient: NfeRecipient;
  items: NfeItem[];
  totals: NfeTotalsSnapshot;
  payment: NfePaymentSnapshot;
  additionalInfo: string | null;
  externalId: string | null;
  /** Whether the customer gets the documents by e-mail once they are ready. */
  sendEmail: boolean;
}

export interface NfeTransitionInfo {
  cStat?: string | null;
  xMotivo?: string | null;
}

/** What the SEFAZ answered when it authorized the document (structural: the domain knows no adapter). */
export interface NfeAuthorizationInfo {
  accessKey: string;
  protocol?: string;
  authorizedAt?: Date;
  cStat?: string;
  xMotivo?: string;
  protNFeXml?: string;
}

export class NfeDocument {
  private constructor(private props: NfeDocumentProps) {}

  static create(
    params: CreateNfeDocumentParams,
    now: Date = new Date(),
  ): NfeDocument {
    return new NfeDocument({
      id: params.id ?? randomUUID(),
      tenantId: params.tenantId,
      companyId: params.companyId,
      environment: params.environment,
      model: params.model ?? 55,
      series: null,
      number: null,
      accessKey: null,
      cNf: null,
      tpEmis: 1,
      issuedAt: null,
      natOp: params.natOp,
      idDest: params.idDest,
      indFinal: params.indFinal,
      indPres: params.indPres,
      finNfe: params.finNfe,
      tpImp: params.tpImp,
      status: 'queued',
      cStat: null,
      xMotivo: null,
      protocol: null,
      authorizedAt: null,
      recipient: params.recipient,
      items: params.items,
      totals: params.totals,
      payment: params.payment,
      transport: { modFrete: 9 },
      additionalInfo: params.additionalInfo ?? null,
      externalId: params.externalId ?? null,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      signedXml: null,
      protNfeXml: null,
      attempt: 0,
      authority: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorType: null,
      nextCheckAt: null,
      reconcileAttempts: 0,
      sendEmail: params.sendEmail ?? true,
      documentsReadyAt: null,
      emailStatus: null,
      emailSentAt: null,
      cancelReason: null,
      cancelRequestedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: NfeDocumentProps): NfeDocument {
    return new NfeDocument({ ...props });
  }

  toSnapshot(): NfeDocumentSnapshot {
    return { ...this.props };
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get companyId(): string {
    return this.props.companyId;
  }
  get environment(): ExecutionEnvironment {
    return this.props.environment;
  }
  get status(): NfeStatus {
    return this.props.status;
  }
  get number(): number | null {
    return this.props.number;
  }
  get series(): number | null {
    return this.props.series;
  }
  get accessKey(): string | null {
    return this.props.accessKey;
  }
  get attempt(): number {
    return this.props.attempt;
  }

  /** The history row of the creation (no previous state), written with the document. */
  creationEntry(): NfeHistoryEntry {
    return this.historyEntry(null, this.props.status);
  }

  /** Moves along the state machine of design spec 8.3 and returns the history row to append. */
  transitionTo(
    status: NfeStatus,
    info: NfeTransitionInfo = {},
    now: Date = new Date(),
  ): NfeHistoryEntry {
    const from = this.props.status;
    if (!NFE_VALID_TRANSITIONS[from].includes(status))
      throw new InvalidNfeTransitionError(from, status);
    this.props.status = status;
    if (info.cStat !== undefined) this.props.cStat = info.cStat;
    if (info.xMotivo !== undefined) this.props.xMotivo = info.xMotivo;
    this.props.updatedAt = now;
    return this.historyEntry(from, status);
  }

  /** The number is assigned once; a resubmission after a rejection keeps it (design spec 8.3). */
  assignNumber(series: number, number: number): void {
    if (this.props.number !== null) throw new NfeNumberAlreadyAssignedError();
    this.props.series = series;
    this.props.number = number;
  }

  /**
   * Starts a new signed version of the document: a new `cNF`, hence a new key and a new signed
   * XML. The row it returns carries the new key and the new `attempt`; the key of the previous
   * attempt stays in the history row written when that attempt ended.
   */
  startAttempt(
    cNf: string,
    accessKey: string,
    signedXml: string,
    issuedAt: Date,
    now: Date = new Date(),
  ): NfeHistoryEntry {
    this.props.attempt += 1;
    this.props.cNf = cNf;
    this.props.accessKey = accessKey;
    this.props.signedXml = signedXml;
    this.props.issuedAt = issuedAt;
    this.props.updatedAt = now;
    return this.historyEntry(this.props.status, this.props.status);
  }

  markAuthorized(
    auth: NfeAuthorizationInfo,
    now: Date = new Date(),
  ): NfeHistoryEntry {
    const entry = this.transitionTo(
      'authorized',
      { cStat: auth.cStat ?? '100', xMotivo: auth.xMotivo ?? null },
      now,
    );
    this.props.protocol = auth.protocol ?? this.props.protocol;
    this.props.authorizedAt = auth.authorizedAt ?? now;
    if (auth.protNFeXml !== undefined) this.props.protNfeXml = auth.protNFeXml;
    this.props.nextCheckAt = null;
    this.props.lastErrorCode = null;
    this.props.lastErrorMessage = null;
    this.props.lastErrorType = null;
    return entry;
  }

  /**
   * The authorization data, without moving the state: `transitionTo('authorized')` is applied
   * separately (by the transition service) so both happen under the same row lock.
   */
  recordAuthorization(
    auth: NfeAuthorizationInfo,
    now: Date = new Date(),
  ): void {
    this.props.protocol = auth.protocol ?? this.props.protocol;
    this.props.authorizedAt = auth.authorizedAt ?? now;
    if (auth.protNFeXml !== undefined) this.props.protNfeXml = auth.protNFeXml;
    this.props.nextCheckAt = null;
    this.clearError();
  }

  /**
   * The `nfeProc` and the DANFE are stored: first write wins, so a worker that loses the race (or a
   * redelivered message) finds it already done and gets `false`.
   */
  markDocumentsReady(now: Date = new Date()): boolean {
    if (this.props.documentsReadyAt) return false;
    this.props.documentsReadyAt = now;
    this.props.updatedAt = now;
    return true;
  }

  /** The e-mail to the customer: asked for (`queued`), delivered (`sent`) or given up (`failed`). */
  recordEmail(
    status: 'queued' | 'sent' | 'failed',
    now: Date = new Date(),
  ): void {
    this.props.emailStatus = status;
    if (status === 'sent') this.props.emailSentAt = now;
    this.props.updatedAt = now;
  }

  /** The customer asked to cancel: the reason and the moment stay on the document. */
  recordCancellationRequest(reason: string, now: Date = new Date()): void {
    this.props.cancelReason = reason;
    this.props.cancelRequestedAt = now;
  }

  /** What the customer sees as `lastError`; `null` clears it. */
  recordError(error: NfeLastError | null): void {
    this.props.lastErrorType = error?.type ?? null;
    this.props.lastErrorCode = error?.code ?? null;
    this.props.lastErrorMessage = error?.message ?? null;
  }

  clearError(): void {
    this.recordError(null);
  }

  /** The authority (SEFAZ) that serves this UF, kept for the breaker and for support. */
  setAuthority(authority: string): void {
    this.props.authority = authority;
  }

  /** When the next automatic look at the SEFAZ is due (`null` once there is none). */
  scheduleCheck(nextCheckAt: Date | null, reconcileAttempts?: number): void {
    this.props.nextCheckAt = nextCheckAt;
    if (reconcileAttempts !== undefined)
      this.props.reconcileAttempts = reconcileAttempts;
  }

  /**
   * A rejected document corrected by the customer: the content is replaced, the number stays (the
   * next attempt only draws a new `cNF`). The idempotency key stays the one the document was
   * created with; the hash follows the latest body.
   */
  replaceContent(
    content: NfeContent,
    requestHash: string,
    now: Date = new Date(),
  ): void {
    if (this.props.status !== 'rejected')
      throw new InvalidNfeTransitionError(this.props.status, 'queued');
    Object.assign(this.props, content, { requestHash, updatedAt: now });
    this.props.reconcileAttempts = 0;
    this.props.nextCheckAt = null;
  }

  private historyEntry(from: NfeStatus | null, to: NfeStatus): NfeHistoryEntry {
    return {
      tenantId: this.props.tenantId,
      documentId: this.props.id,
      fromStatus: from,
      toStatus: to,
      accessKey: this.props.accessKey,
      attempt: this.props.attempt,
      cStat: this.props.cStat,
      xMotivo: this.props.xMotivo,
    };
  }
}
