import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthUserService } from './auth-user.service';

export const AUTH_LOGIN_RECORDED = 'auth.login.recorded';

export type AuthLoginRecordedEvent = {
  name: typeof AUTH_LOGIN_RECORDED;
  authUserId: string;
  occurredAt: Date;
};

export function authLoginRecorded(
  authUserId: string,
  occurredAt = new Date(),
): AuthLoginRecordedEvent {
  return { name: AUTH_LOGIN_RECORDED, authUserId, occurredAt };
}

@Injectable()
export class AuthLoginRecordedListener {
  constructor(private readonly authUsers: AuthUserService) {}

  @OnEvent(AUTH_LOGIN_RECORDED)
  onLoginRecorded(event: AuthLoginRecordedEvent): Promise<void> {
    return this.authUsers.markLogin(event.authUserId, event.occurredAt);
  }
}
