import { TenantPermission } from './permission';

export class TenantMembershipNotFoundError extends Error {
  constructor() {
    super('Tenant membership was not found');
    this.name = 'TenantMembershipNotFoundError';
  }
}

export class TenantMembershipInactiveError extends Error {
  constructor() {
    super('Tenant membership is inactive');
    this.name = 'TenantMembershipInactiveError';
  }
}

export class AuthUserEmailAlreadyExistsError extends Error {
  constructor(_email: string) {
    super('Auth user email already exists');
    this.name = 'AuthUserEmailAlreadyExistsError';
  }
}

export class TenantAccessDeniedError extends Error {
  constructor() {
    super('Tenant access denied');
    this.name = 'TenantAccessDeniedError';
  }
}

export class TenantPermissionDeniedError extends Error {
  constructor(permission: TenantPermission) {
    super(`Tenant permission "${permission}" is required`);
    this.name = 'TenantPermissionDeniedError';
  }
}

export class UnknownTenantPermissionError extends Error {
  constructor(permission: string) {
    super(`Tenant permission "${permission}" is not in the catalog`);
    this.name = 'UnknownTenantPermissionError';
  }
}

export class LastTenantAdminError extends Error {
  constructor() {
    super('Cannot deactivate or demote the last active tenant admin');
    this.name = 'LastTenantAdminError';
  }
}

export class DuplicatePendingInvitationError extends Error {
  constructor() {
    super('A pending invitation already exists for this tenant and email');
    this.name = 'DuplicatePendingInvitationError';
  }
}

export class TenantInvitationNotFoundError extends Error {
  constructor() {
    super('Tenant invitation was not found');
    this.name = 'TenantInvitationNotFoundError';
  }
}

export class TenantInvitationExpiredError extends Error {
  constructor() {
    super('Tenant invitation has expired');
    this.name = 'TenantInvitationExpiredError';
  }
}

export class TenantInvitationNotRenewableError extends Error {
  constructor() {
    super('Tenant invitation cannot be renewed in its current state');
    this.name = 'TenantInvitationNotRenewableError';
  }
}
