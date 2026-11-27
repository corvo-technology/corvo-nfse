import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LifecycleEmailsConfig } from '@/infra/config/configuration.types';
import { IS_SELF_HOSTED } from '@/shared/deployment-mode';

export type LifecycleEmailFlag = Exclude<
  keyof LifecycleEmailsConfig,
  'enabled'
>;

/** Which lifecycle e-mails are on. Every kind is on by default; the master switch turns all off. */
@Injectable()
export class LifecycleEmailSettings {
  constructor(private readonly config: ConfigService) {}

  isOn(flag: LifecycleEmailFlag): boolean {
    // Billing and onboarding e-mails are the cloud product's: a self-hosted install has no plans.
    if (IS_SELF_HOSTED) return false;
    const settings = this.config.get<LifecycleEmailsConfig>('lifecycleEmails');
    if (!settings) return true;
    return settings.enabled && settings[flag];
  }
}
