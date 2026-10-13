export type OtpChannel = 'email' | 'whatsapp';
export type OtpAudience = 'public' | 'authenticated';

export const OTP_PURPOSES = [
  'email_verification',
  'phone_verification',
  'login_challenge',
  'payment_authorization',
  'consent_confirmation',
  'account_recovery',
  'magic_link_login',
] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const PUBLIC_OTP_PURPOSES: readonly OtpPurpose[] = [
  'email_verification',
  'phone_verification',
  'login_challenge',
  'account_recovery',
  'magic_link_login',
];

export interface OtpScopeInput {
  audience: OtpAudience;
  productKey: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  subjectId: string;
  target: string;
  contextId?: string;
  tenantId?: string;
}

export interface IssueOtpInput extends OtpScopeInput {
  requestIp?: string;
}

export interface IssueOtpResult {
  challengeId: string;
  code: string;
  expiresAt: number;
  resendAvailableAt: number;
  channel: OtpChannel;
  normalizedTarget: string;
  maskedTarget: string;
}

export interface VerifyOtpInput extends OtpScopeInput {
  challengeId: string;
  code: string;
}

export interface VerifyOtpResult {
  valid: boolean;
  attempts: number;
  maxAttempts: number;
}

export interface StoredOtpChallenge {
  challengeId: string;
  version: 1;
  audience: OtpAudience;
  productHash: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  subjectHash: string;
  targetHash: string;
  contextHash: string;
  scopeHash: string;
  codeHash: string;
  attempts: number;
  createdAt: number;
  expiresAt: number;
}

export interface OtpVerificationProof {
  version: 1;
  audience: OtpAudience;
  productHash: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  subjectHash: string;
  targetHash: string;
  contextHash: string;
  createdAt: number;
  expiresAt: number;
}
