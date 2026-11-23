import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { RawResponse } from '@/shared/http/response.interceptor';
import type { DeploymentMode } from '@/shared/deployment-mode';

export interface PublicConfig {
  deploymentMode: DeploymentMode;
  billingEnabled: boolean;
  signupMode: 'open' | 'allowlist' | 'closed';
  turnstileSiteKey: string | null;
}

/** What the web needs to know at runtime. Public and secret-free: add a field only if it is both. */
@Controller('config')
@PublicRoute()
@ApiTags('config')
export class PublicConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @RawResponse()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiExcludeEndpoint()
  get(): PublicConfig {
    const deploymentMode =
      this.config.get<DeploymentMode>('DEPLOYMENT_MODE') ?? 'cloud';
    return {
      deploymentMode,
      billingEnabled: deploymentMode === 'cloud',
      signupMode:
        this.config.get<PublicConfig['signupMode']>('AUTH_SIGNUP_MODE') ??
        (deploymentMode === 'cloud' ? 'open' : 'closed'),
      turnstileSiteKey: this.config.get<string>('TURNSTILE_SITE_KEY') ?? null,
    };
  }
}
