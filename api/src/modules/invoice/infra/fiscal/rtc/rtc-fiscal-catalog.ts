import type {
  ClassificationInput,
  ClassificationValidation,
} from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import {
  isRtcTransportError,
  RtcHttpClient,
  type RtcHttpResponse,
} from './rtc-http-client';

/**
 * Fiscal catalog validation against the official Calculadora RTC
 * (docs/fiscal/rtc/README.md). Consults NBS / CST / cClassTrib / cIndOp with
 * the invoice competence date — never today — and caches every response in
 * memory for six hours, dropping everything when `versaoApp/versaoDb` change
 * (the version is polled at most once per minute).
 */

type Unavailable = Extract<ClassificationValidation, { status: 'unavailable' }>;

const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const VERSION_TTL_MS = 60 * 1_000;

const VERSION_PATH = '/calculadora/dados-abertos/versao';
const NBS_LIST_PATH = '/calculadora/dados-abertos/nbs/lista';
const SITUACOES_PATH = '/calculadora/nfse/situacoes-classificacoes-tributarias';
const VALIDATE_PATH = '/calculadora/nfse/indicador-operacao/validate';

const unavailable = (reason: string, transient: boolean): Unavailable => ({
  status: 'unavailable',
  reason,
  transient,
});

interface NbsEntry {
  readonly codigo: string;
}

interface ClassificationCombo {
  readonly codigoSituacaoTributaria: string;
  readonly codigoClassificacaoTributaria: string;
}

type CallOutcome =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: Unavailable };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNbsList = (value: unknown): value is NbsEntry[] =>
  Array.isArray(value) &&
  value.every(
    (item) => isRecord(item) && typeof item['codigo'] === 'string',
  );

const isComboList = (value: unknown): value is ClassificationCombo[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item['codigoSituacaoTributaria'] === 'string' &&
      typeof item['codigoClassificacaoTributaria'] === 'string',
  );

const candidatesOf = (
  combos: readonly ClassificationCombo[],
): ReadonlyArray<{ cst: string; classCode: string }> =>
  combos.map((combo) => ({
    cst: combo.codigoSituacaoTributaria,
    classCode: combo.codigoClassificacaoTributaria,
  }));

export interface RtcFiscalCatalogOptions {
  /** Injectable clock so tests can cross the version poll and cache TTLs. */
  readonly now?: () => number;
}

export class RtcFiscalCatalog {
  private readonly cache = new Map<
    string,
    { readonly value: unknown; readonly expiresAt: number }
  >();
  private readonly now: () => number;
  private version: string | null = null;
  private versionCheckedAt: number | null = null;

  constructor(
    private readonly client: RtcHttpClient,
    options: RtcFiscalCatalogOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async validateClassification(
    input: ClassificationInput,
    date: string,
  ): Promise<ClassificationValidation> {
    const nbs = input.nbsCode;
    if (nbs === null || nbs.trim() === '') {
      return unavailable(
        'nbsCode was not informed; the calculator needs an NBS to validate the classification',
        false,
      );
    }

    await this.refreshVersion();

    const nbsList = await this.call({
      path: NBS_LIST_PATH,
      method: 'GET',
      query: { data: date },
    });
    if (!nbsList.ok) return nbsList.failure;
    if (!isNbsList(nbsList.body)) {
      return unavailable(
        'the calculator returned an unexpected NBS list payload',
        true,
      );
    }
    if (nbsList.body.length === 0) {
      return unavailable(
        `the calculator published no NBS catalog data for ${date}`,
        false,
      );
    }
    if (!nbsList.body.some((entry) => entry.codigo === nbs)) {
      return {
        status: 'invalid',
        issues: [
          {
            field: 'nbsCode',
            reason: `NBS ${nbs} is not published in the official catalog on ${date}`,
          },
        ],
      };
    }

    const combosOutcome = await this.call({
      path: SITUACOES_PATH,
      method: 'GET',
      query: { nbs, data: date },
    });
    if (!combosOutcome.ok) return combosOutcome.failure;
    if (!isComboList(combosOutcome.body)) {
      return unavailable(
        'the calculator returned an unexpected CST x cClassTrib payload',
        true,
      );
    }
    const combos = combosOutcome.body;

    const wantsCst = input.cst !== null;
    const wantsClass = input.classCode !== null;
    const wantsAny = wantsCst || wantsClass;
    const matching = combos.filter(
      (combo) =>
        (!wantsCst || combo.codigoSituacaoTributaria === input.cst) &&
        (!wantsClass ||
          combo.codigoClassificacaoTributaria === input.classCode),
    );

    if (combos.length === 0 && !wantsAny) {
      return unavailable(
        `the calculator published no CST x cClassTrib combinations for NBS ${nbs} on ${date}`,
        false,
      );
    }
    if (wantsAny && matching.length === 0) {
      const issues: Array<{ field: string; reason: string }> = [];
      if (wantsCst) {
        issues.push({
          field: 'cst',
          reason: `CST ${input.cst} x cClassTrib ${
            input.classCode ?? '(not informed)'
          } is not allowed for NBS ${nbs} on ${date}`,
        });
      }
      if (wantsClass) {
        issues.push({
          field: 'classCode',
          reason: `cClassTrib ${input.classCode} is not allowed for NBS ${nbs} on ${date}`,
        });
      }
      return { status: 'invalid', issues };
    }

    if (input.operationIndicator !== null) {
      const classTrib =
        input.classCode ??
        (matching.length === 1
          ? matching[0].codigoClassificacaoTributaria
          : null);
      if (classTrib === null) {
        return { status: 'ambiguous', candidates: candidatesOf(matching) };
      }
      const outcome = await this.call({
        path: VALIDATE_PATH,
        method: 'POST',
        body: {
          cClassTrib: classTrib,
          cIndOp: input.operationIndicator,
          dataOcorrenciaFatoGerador: date,
          nbs,
        },
      });
      if (!outcome.ok) return outcome.failure;
      if (
        !isRecord(outcome.body) ||
        typeof outcome.body['valido'] !== 'boolean'
      ) {
        return unavailable(
          'the calculator returned an unexpected indicador-operacao payload',
          true,
        );
      }
      if (outcome.body['valido'] !== true) {
        return {
          status: 'invalid',
          issues: [
            {
              field: 'operationIndicator',
              reason: `the calculator rejected cIndOp ${input.operationIndicator} for cClassTrib ${classTrib} on NBS ${nbs} (competence ${date})`,
            },
          ],
        };
      }
      return this.validated();
    }

    if (!wantsAny) {
      if (combos.length === 1) return this.validated();
      return { status: 'ambiguous', candidates: candidatesOf(combos) };
    }
    return this.validated();
  }

  private validated(): ClassificationValidation {
    return {
      status: 'validated',
      versions: { rtc: this.version ?? 'unknown' },
    };
  }

  /** Polls `/versao` at most once per minute; a version bump clears the cache. */
  private async refreshVersion(): Promise<void> {
    const now = this.now();
    if (
      this.versionCheckedAt !== null &&
      now - this.versionCheckedAt < VERSION_TTL_MS
    ) {
      return;
    }
    this.versionCheckedAt = now;
    let payload: unknown;
    try {
      const response = await this.client.request({
        path: VERSION_PATH,
        method: 'GET',
      });
      if (response.status !== 200) return;
      payload = JSON.parse(response.text);
    } catch {
      // keep the last known version; the catalog calls below surface outages
      return;
    }
    if (
      !isRecord(payload) ||
      typeof payload['versaoApp'] !== 'string' ||
      typeof payload['versaoDb'] !== 'string'
    ) {
      return;
    }
    const next = `${payload['versaoApp']}/${payload['versaoDb']}`;
    if (this.version !== null && this.version !== next) {
      this.cache.clear();
    }
    this.version = next;
  }

  /** One cached calculator call, keyed by (endpoint, params, date). */
  private async call(args: {
    readonly path: string;
    readonly method: 'GET' | 'POST';
    readonly query?: Readonly<Record<string, string>>;
    readonly body?: Readonly<Record<string, string>>;
  }): Promise<CallOutcome> {
    const search = new URLSearchParams(args.query ?? {}).toString();
    const path = search === '' ? args.path : `${args.path}?${search}`;
    const key =
      args.method === 'POST'
        ? `POST ${path} ${JSON.stringify(args.body ?? {})}`
        : `GET ${path}`;

    const cached = this.cache.get(key);
    const now = this.now();
    if (cached !== undefined && cached.expiresAt > now) {
      return { ok: true, body: cached.value };
    }

    let response: RtcHttpResponse;
    try {
      response = await this.client.request({
        path,
        method: args.method,
        ...(args.body === undefined ? {} : { body: args.body }),
      });
    } catch (error) {
      if (isRtcTransportError(error)) {
        return {
          ok: false,
          failure: unavailable(
            `the calculator is unreachable (${error.reason})`,
            true,
          ),
        };
      }
      throw error;
    }

    if (response.status >= 200 && response.status < 300) {
      let payload: unknown;
      try {
        payload = JSON.parse(response.text);
      } catch {
        return {
          ok: false,
          failure: unavailable(
            'the calculator returned a non-JSON body',
            true,
          ),
        };
      }
      this.cache.set(key, { value: payload, expiresAt: now + CACHE_TTL_MS });
      return { ok: true, body: payload };
    }
    if (response.status === 429 || response.status >= 500) {
      return {
        ok: false,
        failure: unavailable(
          `the calculator answered HTTP ${response.status}`,
          true,
        ),
      };
    }
    return {
      ok: false,
      failure: unavailable(
        `unexpected HTTP ${response.status} from the calculator`,
        false,
      ),
    };
  }
}
