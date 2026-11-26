import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import type {
  Authorization,
  CancelCapability,
  CancelRequest,
  ConsultCapability,
  ConsultResult,
  EventReceipt,
  FiscalDocumentGateway,
  IssueCapability,
  SigningContext,
} from '@/modules/fiscal-core/domain/ports/gateway.port';
import type {
  FiscalProvider,
  ICancelPayload,
  IIssuePayload,
} from './nfse-fiscal-provider';

/** Never lets an exception out: a timeout is uncertain, anything else is a network failure. */
function communicationFailure(error: unknown): GatewayOutcome<never> {
  const name = error instanceof Error ? error.name : '';
  return {
    kind: 'uncertain',
    reason: name === 'TimeoutError' ? 'timeout' : 'network',
  };
}

/**
 * Wraps the current NFS-e provider behind the shared fiscal ports without changing what it does.
 * The document type is the existing `IIssuePayload` (it already carries the PFX), so the NFS-e
 * workflow keeps calling the provider directly.
 */
export class NfseGatewayAdapter implements FiscalDocumentGateway<IIssuePayload> {
  readonly type = 'nfse' as const;

  constructor(private readonly provider: FiscalProvider) {}

  readonly issuer: IssueCapability<IIssuePayload> = {
    issue: async (
      doc: IIssuePayload,
    ): Promise<GatewayOutcome<Authorization>> => {
      try {
        const result = await this.provider.issue(doc);
        if (result.requiresReconciliation)
          return { kind: 'uncertain', reason: 'server' };
        if (!result.success)
          return {
            kind: 'rejected',
            code: result.errorCode ?? 'UNKNOWN',
            message: result.errorMessage ?? '',
          };
        return {
          kind: 'ok',
          value: {
            accessKey: result.accessKey ?? '',
            number: result.nfseNumber,
            authorizedXml: result.xmlAuthorized,
          },
        };
      } catch (error) {
        return communicationFailure(error);
      }
    },
  };

  readonly consult: ConsultCapability = {
    consultByKey: async (
      key: string,
      ctx: SigningContext,
    ): Promise<GatewayOutcome<ConsultResult>> => {
      try {
        const result = await this.provider.queryByAccessKey(
          key,
          ctx.tpAmb === 1 ? 'live' : 'test',
        );
        if (result.status === 'rejected')
          return {
            kind: 'rejected',
            code: result.errorCode ?? 'UNKNOWN',
            message: result.errorMessage ?? '',
          };
        return {
          kind: 'ok',
          value: {
            status: result.status,
            accessKey: result.accessKey,
            xml: result.xmlAuthorized,
          },
        };
      } catch (error) {
        return communicationFailure(error);
      }
    },
  };

  /** `req.context` must carry the provider's `ICancelPayload` (certificate and reason). */
  readonly cancel: CancelCapability = {
    cancel: async (
      req: CancelRequest,
    ): Promise<GatewayOutcome<EventReceipt>> => {
      if (!req.context)
        return {
          kind: 'rejected',
          code: 'CANCEL_CONTEXT_MISSING',
          message: 'NFS-e cancellation needs the provider payload',
        };
      try {
        const result = await this.provider.cancel(
          req.context as ICancelPayload,
        );
        if (result.status === 'cancelled')
          return { kind: 'ok', value: { protocol: '', cStat: 'cancelled' } };
        if (result.status === 'rejected')
          return {
            kind: 'rejected',
            code: result.errorCode,
            message: result.errorMessage,
          };
        return { kind: 'uncertain', reason: 'server' };
      } catch (error) {
        return communicationFailure(error);
      }
    },
  };
}
