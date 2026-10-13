import { OAuthAuthorizationCode } from './oauth-authorization-code';

export abstract class IOAuthAuthorizationCodeRepository {
  abstract findActiveByCodeHash(
    codeHash: string,
    now?: Date,
  ): Promise<OAuthAuthorizationCode | null>;
  abstract save(code: OAuthAuthorizationCode): Promise<OAuthAuthorizationCode>;
  abstract update(
    code: OAuthAuthorizationCode,
  ): Promise<OAuthAuthorizationCode>;
}
