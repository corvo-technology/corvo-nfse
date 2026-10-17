import { createHash } from 'crypto';

export type MetaUserDataInput = {
  email: string;
  authUserId: string;
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
};

export type MetaUserData = {
  em: string[];
  external_id: string[];
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeEmailForHashing(email: string): string {
  return email.trim().toLowerCase();
}

/** Not used today: signup collects no phone number. Kept for a future WhatsApp-sourced signup. */
export function normalizePhoneForHashing(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

/** CPF/CNPJ never enter Meta's user_data; only email and the hashed internal user id identify the lead. */
export function buildMetaUserData(input: MetaUserDataInput): MetaUserData {
  const data: MetaUserData = {
    em: [sha256(normalizeEmailForHashing(input.email))],
    external_id: [sha256(input.authUserId)],
  };
  if (input.fbp) data.fbp = input.fbp;
  if (input.fbc) data.fbc = input.fbc;
  if (input.clientIp) data.client_ip_address = input.clientIp;
  if (input.userAgent) data.client_user_agent = input.userAgent;
  return data;
}
