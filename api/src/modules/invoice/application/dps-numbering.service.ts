import { Inject, Injectable, Optional } from '@nestjs/common';
import { buildDpsId } from 'open-nfse';
import { NfseProviderFactory } from '@/infra/external/nfse/nfse-provider.factory';
import type {
  FiscalQueryResult,
  IIssuePayload,
} from '@/infra/external/nfse/nfse-fiscal-provider';
import { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import { CompanyService } from '@/modules/company/application/company.service';
import { FiscalPortalBreaker } from './fiscal-portal-breaker';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  DPS_SEQUENCE_REPOSITORY,
  type IDpsSequenceRepository,
} from '../domain/dps-sequence';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '../domain/invoice.repository';

/**
 * How many consecutive numbers are asked to the government at most (stops at the first free one).
 * When all are used the owner is asked to check the numbering instead of probing further.
 */
export const NUMBERING_PROBE_LIMIT = 10;

export const DPS_NUMBERING_NEEDS_CONFIRMATION =
  'DPS_NUMBERING_NEEDS_CONFIRMATION';
export const DPS_NUMBERING_CHECK_UNAVAILABLE =
  'DPS_NUMBERING_CHECK_UNAVAILABLE';

export interface NumberingCheck {
  series: string;
  /** The number the next note would take. */
  nextNumber: number;
  /** Numbers, starting at `nextNumber`, that the government already has. */
  usedNumbers: number[];
  /** First number that is free for sure (after the used ones). */
  suggestedNext: number;
  /** True when every number asked was used, so more may be used after `suggestedNext`. */
  moreMayBeUsed: boolean;
}

/** Numbers the government already had, skipped on purpose before the first note. */
export interface SkippedNumbers {
  from: number;
  to: number;
  nextFree: number;
}

export function skippedNumbersMessage(skipped: SkippedNumbers): string {
  const range =
    skipped.from === skipped.to
      ? `O número ${skipped.from} já estava usado`
      : `Os números ${skipped.from} a ${skipped.to} já estavam usados`;
  return `${range} no governo; a nota saiu com o número ${skipped.nextFree}.`;
}

/** The government did not answer: the caller may try again later. */
export class NumberingCheckUnavailableError extends Error {
  readonly code = DPS_NUMBERING_CHECK_UNAVAILABLE;
  constructor(cause?: unknown) {
    super(
      'O governo não respondeu agora à conferência da numeração das notas. Nada foi emitido nem alterado; tente de novo em alguns minutos.',
      { cause },
    );
  }
}

/** The numbers are already used at the government: the owner must pick the numbering. */
export class NumberingNeedsConfirmationError extends Error {
  readonly code = DPS_NUMBERING_NEEDS_CONFIRMATION;
  constructor(readonly check: NumberingCheck) {
    super(numberingNeedsConfirmationMessage(check));
  }
}

export function numberingNeedsConfirmationMessage(
  check: NumberingCheck,
): string {
  const used = check.usedNumbers;
  const range =
    used.length === 1 ? `${used[0]}` : `${used[0]} a ${used[used.length - 1]}`;
  const label = used.length === 1 ? 'O número de nota' : 'Os números de nota';
  const verb = used.length === 1 ? 'já foi usado' : 'já foram usados';
  const more = check.moreMayBeUsed ? ' (e talvez os seguintes)' : '';
  return `${label} ${range} ${verb}${more} no governo para este CNPJ. Ajuste a numeração das notas da empresa (sugestão: começar no ${check.suggestedNext}) e emita de novo.`;
}

/**
 * Asks the government which DPS numbers of a company are already taken, before the first
 * emission. Read-only against the portal: it never issues and never changes the numbering.
 */
@Injectable()
export class DpsNumberingService {
  constructor(
    @Inject(DPS_SEQUENCE_REPOSITORY)
    private readonly sequences: IDpsSequenceRepository,
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    private readonly companies: CompanyService,
    private readonly certificates: ApplicationCertificateDecryptor,
    private readonly providers: NfseProviderFactory,
    @Optional() private readonly breaker?: FiscalPortalBreaker,
  ) {}

  /** Probes the portal for the next numbers. Throws NumberingCheckUnavailableError when it cannot answer. */
  async check(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NumberingCheck> {
    const company = await this.companies.findById(
      companyId,
      tenantId,
      environment,
    );
    const municipality = company.municipalityCode;
    if (!municipality)
      throw new NumberingCheckUnavailableError(
        new Error('Company municipalityCode is missing'),
      );
    const current = await this.sequences.current(
      companyId,
      tenantId,
      environment,
    );
    const nextNumber = current.lastNumber + 1;
    const provider = this.providers.resolve(environment);
    let credentials: IIssuePayload;
    try {
      const decrypted = this.providers.isSimulated(environment)
        ? { pfxBuffer: Buffer.alloc(0), password: '' }
        : await this.certificates.decryptCredentials(
            companyId,
            tenantId,
            environment,
          );
      // The portal lookup only needs the certificate and the environment.
      credentials = {
        pfxBuffer: decrypted.pfxBuffer,
        p12Password: decrypted.password,
        environment,
      } as IIssuePayload;
    } catch (error) {
      throw new NumberingCheckUnavailableError(error);
    }
    // While the portal is paused no probe is sent.
    if (!this.providers.isSimulated(environment)) {
      try {
        await this.breaker?.assertAvailable(environment);
      } catch (error) {
        throw new NumberingCheckUnavailableError(error);
      }
    }
    const used: number[] = [];
    for (let i = 0; i < NUMBERING_PROBE_LIMIT; i++) {
      const number = nextNumber + i;
      const idDps = buildDpsId({
        cLocEmi: municipality,
        tipoInsc: 'CNPJ',
        inscricaoFederal: company.taxId,
        serie: current.series,
        nDPS: String(number),
      });
      let answer: FiscalQueryResult;
      try {
        answer = await provider.queryByDps(idDps, credentials);
      } catch (error) {
        throw new NumberingCheckUnavailableError(error);
      }
      if (answer.status === 'not_found') break;
      // The portal only says "pending" or "rejected" when it is not conclusive: never guess.
      if (answer.status === 'pending' || answer.status === 'rejected')
        throw new NumberingCheckUnavailableError(
          new Error(`Unexpected portal answer: ${answer.status}`),
        );
      used.push(number);
    }
    return {
      series: current.series,
      nextNumber,
      usedNumbers: used,
      suggestedNext: nextNumber + used.length,
      moreMayBeUsed: used.length === NUMBERING_PROBE_LIMIT,
    };
  }

  /** Whether the check before the first emission is still pending for this company. */
  async isPending(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<boolean> {
    if (this.providers.isSimulated(environment)) return false;
    // Produção Restrita notes have no fiscal value: a number used there does not matter.
    if (environment === 'test') return false;
    if (
      await this.sequences.numberingCheckedAt(companyId, tenantId, environment)
    )
      return false;
    return !(await this.invoices.hasIssuedNote(
      companyId,
      tenantId,
      environment,
    ));
  }

  /**
   * Runs before the DPS number is reserved on the first emission of a company in an environment.
   * Does nothing once the numbering was checked or the company already has a note at the
   * government. When the government confirms numbers as used, the numbering is raised past them
   * (never lowered) so the note leaves with the next free number; the caller records `skipped`.
   * Throws NumberingNeedsConfirmationError when every number asked is used (cap reached) and
   * NumberingCheckUnavailableError when the portal does not answer: nothing is guessed.
   */
  async skipUsedNumbers(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<SkippedNumbers | null> {
    if (!(await this.isPending(companyId, tenantId, environment))) return null;
    return this.skipForward(companyId, tenantId, environment);
  }

  /**
   * Asks the government from the next number on and raises the numbering past the numbers it
   * confirms as used. Used on the first note and again whenever a number turns out to be taken
   * (the number just burned is already behind the sequence, so the probe starts after it).
   */
  async skipForward(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<SkippedNumbers | null> {
    // In test the burned number is already behind the sequence: the next one is simply taken.
    if (environment === 'test') return null;
    const result = await this.check(companyId, tenantId, environment);
    if (result.moreMayBeUsed) throw new NumberingNeedsConfirmationError(result);
    const used = result.usedNumbers;
    if (used.length > 0)
      await this.sequences.raiseTo(
        companyId,
        tenantId,
        environment,
        result.suggestedNext - 1,
      );
    await this.sequences.markNumberingChecked(companyId, tenantId, environment);
    if (used.length === 0) return null;
    return {
      from: used[0],
      to: used[used.length - 1],
      nextFree: result.suggestedNext,
    };
  }

  /** Owner confirmed: optionally moves the numbering forward, then marks the check as done. */
  async confirm(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    lastNumber?: number,
  ): Promise<{ series: string; lastNumber: number }> {
    if (lastNumber !== undefined)
      await this.sequences.raiseTo(
        companyId,
        tenantId,
        environment,
        lastNumber,
      );
    await this.sequences.markNumberingChecked(companyId, tenantId, environment);
    return this.sequences.current(companyId, tenantId, environment);
  }
}
