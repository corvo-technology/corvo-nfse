import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '@/infra/config/configuration.types';

export type TurnstileVerificationInput = {
  token: string;
  remoteIp?: string;
};

export type TurnstileVerificationResult =
  | {
      success: true;
      hostname?: string;
      action?: string;
      cdata?: string;
      challengeTs?: string;
    }
  | {
      success: false;
      errorCodes: string[];
    };

type CloudflareTurnstileResponse = {
  success: boolean;
  hostname?: string;
  action?: string;
  cdata?: string;
  challenge_ts?: string;
  'error-codes'?: string[];
};

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

@Injectable()
export class TurnstileVerificationService {
  constructor(private readonly config: ConfigService<AppConfiguration>) {}

  async verify(
    input: TurnstileVerificationInput,
  ): Promise<TurnstileVerificationResult> {
    const nodeEnv = this.config.get<AppConfiguration['app']>('app')?.nodeEnv;
    if (nodeEnv === 'development') {
      return { success: true };
    }

    const secret =
      this.config.get<AppConfiguration['turnstile']>('turnstile')?.secretKey;
    if (!secret) {
      throw new ServiceUnavailableException(
        'Turnstile verification is not configured',
      );
    }

    const body: Record<string, string> = {
      secret,
      response: input.token,
      idempotency_key: crypto.randomUUID(),
    };
    if (input.remoteIp) {
      body.remoteip = input.remoteIp;
    }

    let payload: CloudflareTurnstileResponse;
    try {
      const response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `Cloudflare Turnstile returned HTTP ${response.status}`,
        );
      }
      payload = (await response.json()) as CloudflareTurnstileResponse;
    } catch {
      throw new BadGatewayException('Turnstile verification unavailable');
    }

    if (typeof payload?.success !== 'boolean') {
      throw new BadGatewayException('Invalid Turnstile verification response');
    }

    if (!payload.success) {
      return {
        success: false,
        errorCodes: Array.isArray(payload['error-codes'])
          ? payload['error-codes']
          : [],
      };
    }

    return {
      success: true,
      hostname: payload.hostname,
      action: payload.action,
      cdata: payload.cdata,
      challengeTs: payload.challenge_ts,
    };
  }
}
