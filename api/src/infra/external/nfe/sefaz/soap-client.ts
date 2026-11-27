import { createHash } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { Agent, type Dispatcher } from 'undici';
import type { AuthorityEndpoint } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import { ICP_BRASIL_CA } from './certificate-loader';

export interface SoapRequest {
  endpoint: AuthorityEndpoint;
  /** XML of the message (consStatServ, enviNFe...), without the XML declaration. */
  bodyXml: string;
  certificate: LoadedCertificate;
  timeoutMs: number;
  /** The backup route (HTTP CONNECT proxy, mTLS still end to end). Absent = our own direct mTLS agent. */
  dispatcher?: Dispatcher;
}

export type SoapResult =
  | { kind: 'ok'; bodyXml: string; durationMs: number }
  | { kind: 'uncertain'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'unavailable' };

/** The only thing the client ever logs: no XML, no certificate, no CPF. */
export interface SoapLogEntry {
  authority: string;
  service: string;
  durationMs: number;
  httpStatus?: number;
  outcome: string;
}

export interface SefazSoapClientOptions {
  /** Test hook: replaces the mTLS dispatcher (a MockAgent). */
  dispatcherFor?: (certificate: LoadedCertificate) => Dispatcher;
  /**
   * Picks the backup route for a call: a dispatcher while the proxy is in use, `undefined` for the direct
   * route. A failure here means direct.
   */
  proxyFor?: (
    host: string,
    certificate: LoadedCertificate,
  ) => Promise<Dispatcher | undefined>;
  logger?: (entry: SoapLogEntry) => void;
}

const SOAP12_ENVELOPE = 'http://www.w3.org/2003/05/soap-envelope';
const AGENT_CACHE_SIZE = 50;

/** Node's own roots plus the ICP-Brasil chain; the server certificate is always verified. */
export const SEFAZ_TRUST_ROOTS: string[] = [...rootCertificates, ICP_BRASIL_CA];

/** Errors raised before a single byte of the body could reach the server. */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE',
]);

const TIMEOUT_CODES = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ETIMEDOUT',
]);

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: unknown } | null;
  if (typeof e?.code === 'string') return e.code;
  return e?.cause ? errorCode(e.cause) : undefined;
}

function stripDeclaration(xml: string): string {
  return xml.replace(/^\s*<\?xml[^?]*\?>\s*/, '');
}

/** The WSDL namespace is the SOAPAction without its last segment (the method). */
function namespaceOf(soapAction: string): string {
  return soapAction.slice(0, soapAction.lastIndexOf('/'));
}

/** `.../NFeStatusServico4/nfeStatusServicoNF` -> `NFeStatusServico4`. */
function serviceOf(soapAction: string): string {
  return soapAction.split('/').at(-2) ?? 'unknown';
}

/**
 * Pulls the SEFAZ answer (`retConsStatServ`, `retEnviNFe`...) out of the SOAP body, unwrapping
 * `nfeResultMsg` (or the per-method wrapper some authorities use).
 */
export function extractSoapResult(responseXml: string): string | null {
  const body = /<(?:[\w-]+:)?Body[^>]*>([\s\S]*)<\/(?:[\w-]+:)?Body>/.exec(
    responseXml,
  );
  if (!body) return null;
  let inner = body[1].trim();
  for (let depth = 0; depth < 3; depth++) {
    const element =
      /^<(?:[\w-]+:)?([\w-]+)\b[^>]*>([\s\S]*)<\/(?:[\w-]+:)?\1>$/.exec(inner);
    if (!element) return inner.length > 0 ? inner : null;
    if (/^(ret|proc)/.test(element[1])) return inner;
    if (element[1] === 'Fault') return null;
    inner = element[2].trim();
  }
  return inner.length > 0 ? inner : null;
}

function classifyTransportError(code: string | undefined): {
  result: SoapResult;
  outcome: string;
} {
  if (code && NOT_SENT_CODES.has(code))
    return { result: { kind: 'unavailable' }, outcome: `not-sent:${code}` };
  if (code && TIMEOUT_CODES.has(code))
    return {
      result: { kind: 'uncertain', reason: 'timeout' },
      outcome: `timeout:${code}`,
    };
  return {
    result: { kind: 'uncertain', reason: 'network' },
    outcome: `network:${code ?? 'unknown'}`,
  };
}

export function buildEnvelope(namespace: string, bodyXml: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<soap12:Envelope xmlns:soap12="${SOAP12_ENVELOPE}">` +
    '<soap12:Body>' +
    `<nfeDadosMsg xmlns="${namespace}">${stripDeclaration(bodyXml)}</nfeDadosMsg>` +
    '</soap12:Body></soap12:Envelope>'
  );
}

export class SefazSoapClient {
  /** One mTLS agent per (cnpj, validity, certificate): Map keeps insertion order for the LRU. */
  private readonly agents = new Map<string, Dispatcher>();

  constructor(private readonly options: SefazSoapClientOptions = {}) {}

  async call(req: SoapRequest): Promise<SoapResult> {
    const { endpoint } = req;
    const started = Date.now();
    const service = serviceOf(endpoint.soapAction);
    const finish = (
      result: SoapResult,
      outcome: string,
      httpStatus?: number,
    ): SoapResult => {
      this.log({
        authority: endpoint.authority,
        service,
        durationMs: Date.now() - started,
        httpStatus,
        outcome,
      });
      return result;
    };

    const url = new URL(endpoint.url);
    let dispatcher: Dispatcher;
    try {
      dispatcher =
        req.dispatcher ??
        (await this.proxied(url.hostname, req.certificate)) ??
        this.dispatcherFor(req.certificate, req.timeoutMs);
    } catch {
      return finish({ kind: 'unavailable' }, 'tls-setup-failed');
    }
    try {
      const response = await dispatcher.request({
        origin: url.origin,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'content-type': `application/soap+xml; charset=utf-8; action="${endpoint.soapAction}"`,
        },
        body: buildEnvelope(namespaceOf(endpoint.soapAction), req.bodyXml),
        headersTimeout: req.timeoutMs,
        bodyTimeout: req.timeoutMs,
      });
      const text = await response.body.text();
      const status = response.statusCode;
      if (status >= 500)
        return finish(
          { kind: 'uncertain', reason: 'server' },
          'http-5xx',
          status,
        );
      if (status >= 300)
        return finish({ kind: 'unavailable' }, 'http-non-success', status);
      const result = extractSoapResult(text);
      if (result === null)
        return finish(
          { kind: 'uncertain', reason: 'server' },
          'no-result',
          status,
        );
      return finish(
        { kind: 'ok', bodyXml: result, durationMs: Date.now() - started },
        'ok',
        status,
      );
    } catch (error) {
      const failure = classifyTransportError(errorCode(error));
      return finish(failure.result, failure.outcome);
    }
  }

  private async proxied(
    host: string,
    certificate: LoadedCertificate,
  ): Promise<Dispatcher | undefined> {
    try {
      return await this.options.proxyFor?.(host, certificate);
    } catch {
      return undefined;
    }
  }

  private log(entry: SoapLogEntry): void {
    const sink =
      this.options.logger ??
      ((e: SoapLogEntry) => process.stdout.write(`${JSON.stringify(e)}\n`));
    sink(entry);
  }

  private dispatcherFor(
    certificate: LoadedCertificate,
    timeoutMs: number,
  ): Dispatcher {
    if (this.options.dispatcherFor)
      return this.options.dispatcherFor(certificate);
    const key = [
      certificate.cnpj,
      certificate.notAfter.toISOString(),
      createHash('sha256')
        .update(certificate.certPem)
        .digest('hex')
        .slice(0, 16),
    ].join(':');
    const cached = this.agents.get(key);
    if (cached) {
      this.agents.delete(key);
      this.agents.set(key, cached);
      return cached;
    }
    const agent = new Agent({
      connect: {
        key: certificate.keyPem,
        cert: certificate.certPem,
        ca: SEFAZ_TRUST_ROOTS,
        rejectUnauthorized: true,
        timeout: timeoutMs,
      },
    });
    this.agents.set(key, agent);
    if (this.agents.size > AGENT_CACHE_SIZE) {
      const [oldest] = this.agents.keys();
      if (oldest !== undefined) {
        void this.agents.get(oldest)?.close();
        this.agents.delete(oldest);
      }
    }
    return agent;
  }
}
