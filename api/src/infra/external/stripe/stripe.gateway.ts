import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { StripeConfig } from '@/infra/config/configuration.types';

export const BILLING_API_VERSION = '2026-09-30.endive';

@Injectable()
export class StripeGateway {
  readonly config: StripeConfig;
  private readonly client: Stripe | null;
  constructor(config: ConfigService) {
    this.config = config.getOrThrow<StripeConfig>('stripe');
    this.client =
      this.config.enabled && this.config.secretKey
        ? new Stripe(this.config.secretKey, {
            apiVersion: BILLING_API_VERSION,
            timeout: 10_000,
            maxNetworkRetries: 1,
          })
        : null;
  }
  get stripe(): Stripe {
    if (!this.client)
      throw new ServiceUnavailableException('Stripe billing is not configured');
    return this.client;
  }
  get enabled(): boolean {
    return this.client !== null;
  }
}
