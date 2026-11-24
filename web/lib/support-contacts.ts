/** Support contacts the owner can set at runtime (server env, no rebuild). Each one is optional. */
export interface SupportContacts {
  whatsappUrl: string | null;
  communityUrl: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export const NO_SUPPORT_CONTACTS: SupportContacts = { whatsappUrl: null, communityUrl: null, email: null, avatarUrl: null };

const DEFAULT_MESSAGE = "Olá! Preciso de ajuda com a Corvo.";

type Env = Record<string, string | undefined>;
type Warn = (message: string) => void;

export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Reads and validates the support variables. Invalid values are ignored with a warning. */
export function readSupportContacts(env: Env = process.env, warn: Warn = (m) => console.warn(m)): SupportContacts {
  const result: SupportContacts = { ...NO_SUPPORT_CONTACTS };

  const rawNumber = env.SUPPORT_WHATSAPP_NUMBER?.trim();
  if (rawNumber) {
    const digits = rawNumber.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) {
      result.whatsappUrl = whatsappLink(digits, env.SUPPORT_WHATSAPP_MESSAGE?.trim() || DEFAULT_MESSAGE);
    } else warn("[support] SUPPORT_WHATSAPP_NUMBER ignored: use only digits with country code (e.g. 5551999999999).");
  }

  const rawCommunity = env.COMMUNITY_WHATSAPP_URL?.trim();
  if (rawCommunity) {
    const url = httpsUrl(rawCommunity);
    if (url && (url.hostname === "chat.whatsapp.com" || url.hostname === "wa.me")) result.communityUrl = url.toString();
    else warn("[support] COMMUNITY_WHATSAPP_URL ignored: must start with https://chat.whatsapp.com/ or https://wa.me/.");
  }

  const rawEmail = env.SUPPORT_EMAIL?.trim();
  if (rawEmail) {
    if (/^[^\s@<>,;:?&]+@[^\s@<>,;:?&]+\.[^\s@<>,;:?&]+$/.test(rawEmail)) result.email = rawEmail;
    else warn("[support] SUPPORT_EMAIL ignored: not a valid e-mail address.");
  }

  const rawAvatar = env.SUPPORT_AVATAR_URL?.trim();
  if (rawAvatar) {
    const url = httpsUrl(rawAvatar);
    if (url) result.avatarUrl = url.toString();
    else warn("[support] SUPPORT_AVATAR_URL ignored: must be an https:// URL.");
  }

  return result;
}

export const hasSupportContacts = (c: SupportContacts) => Boolean(c.whatsappUrl || c.communityUrl || c.email);
