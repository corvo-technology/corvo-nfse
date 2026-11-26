import type {
  NfeEventStatus,
  NfeInutilizationStatus,
} from './nfe-event-status';

/** A fiscal event of an NF-e: cancellation (110111) or correction letter (110110). */
export interface NfeFiscalEvent {
  id: string;
  tenantId: string;
  documentId: string;
  tpEvento: string;
  nSeq: number;
  status: NfeEventStatus;
  protocol: string | null;
  /** What the customer wrote: the justification or the correction. */
  text: string | null;
  /** The signed request. A resend sends exactly this text. */
  requestXml: string | null;
  procXml: string | null;
  cStat: string | null;
  xMotivo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A request to void a range of numbers. */
export interface NfeInutilization {
  id: string;
  tenantId: string;
  companyId: string;
  environment: 'test' | 'live';
  series: number;
  start: number;
  end: number;
  justification: string;
  status: NfeInutilizationStatus;
  protocol: string | null;
  cStat: string | null;
  xMotivo: string | null;
  requestXml: string | null;
  procXml: string | null;
  idempotencyKey: string | null;
  requestHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const CANCEL_TP_EVENTO = '110111';
export const CORRECTION_TP_EVENTO = '110110';
