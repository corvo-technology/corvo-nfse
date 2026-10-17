import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MarketingConfig } from '@/infra/config/configuration.types';

/** Pinned stable Graph API version (released 2026-07-29); bump deliberately after checking Meta's changelog. */
export const META_CAPI_GRAPH_VERSION = 'v26.0';

export interface MetaCapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

/** Signals a 4xx (other than 429) the queue must not retry. */
export class MetaCapiUnrecoverableError extends Error {}

@Injectable()
export class MetaCapiClient {
  private readonly logger = new Logger(MetaCapiClient.name);

  constructor(private readonly config: ConfigService) {}

  async send(event: MetaCapiEvent): Promise<void> {
    const marketing = this.config.getOrThrow<MarketingConfig>('marketing');
    if (!marketing.capiEnabled || !marketing.pixelId || !marketing.capiToken) {
      this.logger.debug(
        `Meta CAPI disabled or unconfigured; skipping event ${event.event_id}`,
      );
      return;
    }

    const response = await this.post(marketing, event);
    if (response.ok) {
      this.logger.log(
        `Meta CAPI event ${event.event_id} accepted (status ${response.status})`,
      );
      return;
    }

    throw await this.toRejectionError(response, event);
  }

  private async post(
    marketing: MarketingConfig,
    event: MetaCapiEvent,
  ): Promise<Response> {
    const url = `https://graph.facebook.com/${META_CAPI_GRAPH_VERSION}/${marketing.pixelId}/events`;
    const body: Record<string, unknown> = {
      data: [event],
      access_token: marketing.capiToken,
    };
    if (marketing.capiTestEventCode) {
      body.test_event_code = marketing.capiTestEventCode;
    }

    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw new Error(
        `Meta CAPI request for event ${event.event_id} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async toRejectionError(
    response: Response,
    event: MetaCapiEvent,
  ): Promise<Error> {
    const fbTraceId = await this.extractFbTraceId(response);
    const message = `Meta CAPI event ${event.event_id} rejected (status ${response.status}, fbtrace_id: ${fbTraceId ?? 'n/a'})`;
    const isUnrecoverable =
      response.status !== 429 &&
      response.status >= 400 &&
      response.status < 500;
    return isUnrecoverable
      ? new MetaCapiUnrecoverableError(message)
      : new Error(message);
  }

  private async extractFbTraceId(
    response: Response,
  ): Promise<string | undefined> {
    try {
      const body = (await response.json()) as {
        error?: { fbtrace_id?: string };
      };
      return body?.error?.fbtrace_id;
    } catch {
      return undefined;
    }
  }
}
