import { OAuthAuthorizationCode } from './oauth-authorization-code';

export abstract class IOAuthAuthorizationCodeRepository {
  abstract consume(
    id: string,
    authUserId: string,
    tenantId: string,
    now?: Date,
  ): Promise<boolean>;
  abstract findActiveByCodeHash(
    codeHash: string,
    now?: Date,
  ): Promise<OAuthAuthorizationCode | null>;
  abstract save(code: OAuthAuthorizationCode): Promise<OAuthAuthorizationCode>;
  abstract update(
    code: OAuthAuthorizationCode,
  ): Promise<OAuthAuthorizationCode>;
}
