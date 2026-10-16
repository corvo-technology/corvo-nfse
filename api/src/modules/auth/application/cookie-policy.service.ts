import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';

export type GreenflowCookieKind =
  | 'session'
  | 'human_login'
  | 'human_signup'
  | 'human_booking'
  | 'human_waitlist'
  | 'human_customer_access'
  | 'human_appointment_cancel'
  | 'human_appointment_reschedule'
  | 'human_otp_issue'
  | 'oauth_state'
  | 'public_customer';

@Injectable()
export class CookiePolicyService {
  private readonly secure: boolean;

  constructor(@Optional() config?: ConfigService) {
    this.secure =
      config?.get<string>('app.nodeEnv') !== 'development' &&
      config?.get<string>('app.nodeEnv') !== 'test';
  }

  name(kind: GreenflowCookieKind): string {
    const suffix: Record<GreenflowCookieKind, string> = {
      session: 'session',
      human_login: 'human_login',
      human_signup: 'human_signup',
      human_booking: 'human_booking',
      human_waitlist: 'human_waitlist',
      human_customer_access: 'human_customer_access',
      human_appointment_cancel: 'human_appointment_cancel',
      human_appointment_reschedule: 'human_appointment_reschedule',
      human_otp_issue: 'human_otp_issue',
      oauth_state: 'oauth_state',
      public_customer: 'public_customer',
    };
    return this.secure ? `__Host-gf_${suffix[kind]}` : `gf_${suffix[kind]}_dev`;
  }

  options(expiresAt?: Date, maxAge?: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      ...(expiresAt ? { expires: expiresAt } : {}),
      ...(maxAge !== undefined ? { maxAge } : {}),
    };
  }

  set(
    response: Response,
    kind: GreenflowCookieKind,
    value: string,
    expiresAt?: Date,
    maxAge?: number,
  ): void {
    response.cookie(this.name(kind), value, this.options(expiresAt, maxAge));
  }

  clear(response: Response, kind: GreenflowCookieKind): void {
    response.clearCookie(this.name(kind), this.options());
  }
}
