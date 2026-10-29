import { Injectable } from '@nestjs/common';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
  type IntegrationEnvironment,
} from '../../domain/connector';
import { wooviBaseUrl } from './woovi-hosts';

@Injectable()
export class WooviClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** Lists one charge: the cheapest authenticated call that proves the AppID works. */
  async checkCredentials(
    appId: string,
    environment: IntegrationEnvironment,
  ): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `${wooviBaseUrl(environment)}/api/v1/charge?limit=1`,
        {
          headers: { Authorization: appId },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new ConnectorTransientError('Could not reach Woovi');
    }
    if (response.ok) return;
    if (response.status === 401 || response.status === 403)
      throw new ConnectorAuthError('Woovi recusou o AppID informado');
    if (response.status === 429 || response.status >= 500)
      throw new ConnectorTransientError(`Woovi answered ${response.status}`);
    throw new ConnectorDataError(`Woovi answered ${response.status}`);
  }
}
