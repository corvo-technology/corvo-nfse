import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/** How long a stored answer is trusted before the readiness read asks the Sefin again. */
export const AGREEMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * What the Sefin answered for the municipality (`consultarConvenio`). `found` is false when the
 * Sefin has no parameters for the code (it answers with a message instead).
 */
export interface MunicipalityAgreementAnswer {
  municipalityCode: string;
  found: boolean;
  /** 1 = pleno, 2 = simplificado. */
  agreementType?: string;
  /** '1' yes, '0' no, '-1' undefined. */
  nationalEnvironment?: string;
  nationalIssuer?: string;
  rfbStandardIssuance?: string;
  message?: string;
}

export interface StoredMunicipalityAgreement {
  answer: MunicipalityAgreementAnswer;
  checkedAt: Date;
}

/**
 * - `not_checked`: nothing stored yet (no certificate, or the Sefin was unreachable);
 * - `active`: the municipality shares notes with the national environment;
 * - `inactive`: it does not, so the Receita may refuse invoices of Simples Nacional ME/EPP;
 * - `unknown`: the Sefin answered "undefined" (-1);
 * - `not_found`: the Sefin has no parameters for this code (most likely a typo).
 */
export type MunicipalityAgreementStatus =
  'not_checked' | 'active' | 'inactive' | 'unknown' | 'not_found';

export interface MunicipalityAgreementView {
  status: MunicipalityAgreementStatus;
  checkedAt: string | null;
  agreementType: string | null;
}

/** Port to the Sefin parameters API. Throws on network or certificate failure. */
export abstract class MunicipalityAgreementPort {
  abstract lookup(input: {
    municipalityCode: string;
    environment: ExecutionEnvironment;
    pfxBuffer: Buffer;
    password: string;
  }): Promise<MunicipalityAgreementAnswer>;
}

/** An answer about another municipality code (the company changed city) is as good as none. */
export function currentAgreement(
  stored: StoredMunicipalityAgreement | null,
  municipalityCode: string | undefined,
): StoredMunicipalityAgreement | null {
  return stored && stored.answer.municipalityCode === municipalityCode
    ? stored
    : null;
}

export function isAgreementStale(
  stored: StoredMunicipalityAgreement | null,
  now: Date,
): boolean {
  return (
    !stored || now.getTime() - stored.checkedAt.getTime() > AGREEMENT_MAX_AGE_MS
  );
}

export function agreementView(
  stored: StoredMunicipalityAgreement | null,
): MunicipalityAgreementView {
  if (!stored)
    return { status: 'not_checked', checkedAt: null, agreementType: null };
  const { answer } = stored;
  let status: MunicipalityAgreementStatus;
  if (!answer.found) status = 'not_found';
  else if (answer.nationalEnvironment === '1') status = 'active';
  else if (answer.nationalEnvironment === '0') status = 'inactive';
  else status = 'unknown';
  return {
    status,
    checkedAt: stored.checkedAt.toISOString(),
    agreementType: answer.agreementType ?? null,
  };
}
