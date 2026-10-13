import { randomBytes } from 'crypto';
import type { Response } from 'express';

const COMPLETION_MESSAGE =
  'Integration complete. You can now close this window.';

/**
 * Completes a browser-based OAuth flow without exposing connection details.
 * Automatic closing only works for windows opened by script (window.open).
 */
export function closeOAuthPopup(res: Response): void {
  const nonce = randomBytes(18).toString('base64');
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  res.status(200);
  res.set({
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': contentSecurityPolicy,
  });
  res.type('html');
  res.send(renderCompletionPage(nonce));
}

function renderCompletionPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Integration complete</title>
  </head>
  <body>
    <p>${COMPLETION_MESSAGE}</p>
    <script nonce="${nonce}">window.close();</script>
  </body>
</html>`;
}
