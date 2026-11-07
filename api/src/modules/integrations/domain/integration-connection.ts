import type { IntegrationEnvironment } from './connector';

export type ConnectionState =
  'draft' | 'active' | 'paused' | 'reauth_required' | 'disconnected';

export interface IntegrationConnection {
  id: string;
  tenantId: string;
  companyId: string;
  publicId: string;
  provider: string;
  environment: IntegrationEnvironment;
  externalAccountId: string | null;
  state: ConnectionState;
  credentialsEnc: string;
  activeFrom: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InvalidConnectionTransitionError extends Error {
  constructor(from: ConnectionState, to: ConnectionState) {
    super(`A connection cannot go from ${from} to ${to}`);
  }
}

const ALLOWED: Record<ConnectionState, ConnectionState[]> = {
  draft: ['active', 'disconnected'],
  active: ['paused', 'reauth_required', 'disconnected'],
  paused: ['active', 'reauth_required', 'disconnected'],
  reauth_required: ['active', 'disconnected'],
  disconnected: [],
};

export function transitionState(
  from: ConnectionState,
  to: ConnectionState,
): ConnectionState {
  if (!ALLOWED[from].includes(to))
    throw new InvalidConnectionTransitionError(from, to);
  return to;
}
