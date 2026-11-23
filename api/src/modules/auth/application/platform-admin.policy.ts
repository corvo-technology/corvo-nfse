import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthUserService } from './auth-user.service';

/** Lowercased, trimmed set of e-mails; empty or missing means nobody. */
export function parsePlatformAdminEmails(
  raw: string | undefined,
): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

/**
 * Who runs the platform: an e-mail in PLATFORM_ADMIN_EMAILS whose owner
 * verified it. Recomputed on every call, so removing an e-mail from the list
 * (or an unverified e-mail) takes effect on the next request.
 */
@Injectable()
export class PlatformAdminPolicy {
  private readonly emails: ReadonlySet<string>;

  constructor(
    config: ConfigService,
    private readonly users: AuthUserService,
  ) {
    this.emails = parsePlatformAdminEmails(
      config.get<string>('PLATFORM_ADMIN_EMAILS'),
    );
  }

  async resolve(
    authUserId: string,
  ): Promise<{ isAdmin: boolean; email: string | null }> {
    const user = await this.users.findById(authUserId);
    if (!user) return { isAdmin: false, email: null };
    const isAdmin =
      this.emails.has(user.email.trim().toLowerCase()) &&
      user.emailVerifiedAt != null;
    return { isAdmin, email: user.email };
  }
}
