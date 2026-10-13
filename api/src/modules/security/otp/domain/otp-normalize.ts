import type { OtpChannel } from './otp.types';
import { InvalidOtpTargetError } from './otp-errors';

export function normalizeOtpTarget(
  channel: OtpChannel,
  target: string,
): string {
  const trimmed = target.trim();

  if (channel === 'email') {
    const normalized = trimmed.toLowerCase();
    if (!isValidEmail(normalized)) {
      throw new InvalidOtpTargetError(channel);
    }
    return normalized;
  }

  if (channel === 'whatsapp') {
    if (!isValidE164(trimmed)) {
      throw new InvalidOtpTargetError(channel);
    }
    return trimmed;
  }

  throw new InvalidOtpTargetError(channel);
}

function isValidEmail(email: string): boolean {
  const atIndex = email.indexOf('@');
  if (atIndex < 1 || atIndex !== email.lastIndexOf('@')) return false;
  const domain = email.slice(atIndex + 1);
  const dotIndex = domain.lastIndexOf('.');
  if (dotIndex < 1 || dotIndex === domain.length - 1) return false;
  return true;
}

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

export function maskOtpTarget(channel: OtpChannel, target: string): string {
  if (channel === 'email') {
    const [local, domain] = target.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return `${target.slice(0, 3)}***${target.slice(-4)}`;
}
