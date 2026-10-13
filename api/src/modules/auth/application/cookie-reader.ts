type CookieRequest = {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
};

export function extractCookie(
  request: CookieRequest,
  name: string,
): string | undefined {
  const parsed = request.cookies?.[name];
  if (typeof parsed === 'string') return parsed;

  const header = firstHeader(request, 'cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function firstHeader(request: CookieRequest, name: string): string | undefined {
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
