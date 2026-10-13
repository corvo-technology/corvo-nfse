import { OAuthClient } from './oauth-client';

export abstract class IOAuthClientRepository {
  abstract findById(id: string): Promise<OAuthClient | null>;
  abstract save(client: OAuthClient): Promise<OAuthClient>;
}
