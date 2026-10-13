/**
 * Server-rendered OAuth consent page for the MCP authorization flow.
 *
 * Single HTML document, no scripts (helmet's CSP blocks them). Styling is
 * inline; the only external assets are the Google Fonts the Corvo frontend
 * already uses (with system fallbacks) and the Corvo logo from the brand CDN. Every interpolated value goes through
 * {@link htmlEscape} to prevent XSS via attacker-controlled OAuth parameters
 * (state, redirect_uri, client name, tenant names).
 *
 * Visual language mirrors corvo-frontend (`app/globals.css`): dark surfaces,
 * Instrument Sans + JetBrains Mono, single emerald accent.
 */

export interface ConsentPageInput {
  clientId: string;
  clientName: string;
  scopes: { name: string; description: string }[];
  tenants: { id: string; name: string }[];
  state: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  /**
   * Form POST target. Defaults to `/mcp/consent`; the controller overrides it
   * when the app is served behind an API prefix (e.g. `/v1/mcp/consent`).
   */
  formAction?: string;
}

export function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** CSP source expression covering the OAuth redirect target. */
export function redirectCspSource(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url.origin
    : url.protocol;
}

/** Same brand asset the MillionSend email templates use (see `welcome`). */
export const CORVO_LOGO_URL =
  'https://assets.greenflow.solutions/brand/corvo-faceted-green.png';
export const CORVO_LOGO_ORIGIN = 'https://assets.greenflow.solutions';

const ICON_READ = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_WRITE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const ICON_SHIELD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6Z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>`;

const STYLES = `
    :root {
      color-scheme: dark;
      --bg: #0a0a0a;
      --surface: #0d0d0d;
      --raised: #111211;
      --border: #1f1f1f;
      --border-strong: #2b2b2b;
      --text: #ededec;
      --text-2: #a1a1a1;
      --text-3: #8f8f8f;
      --accent: oklch(0.82 0.14 165);
      --accent-surface: #0e1512;
      --accent-border: #2f3d38;
      --danger: #c98a6e;
      --danger-surface: #1c1210;
      --danger-border: #3a2218;
      --sans: 'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      font-family: var(--sans);
      font-size: 15px;
      line-height: 1.5;
      color: var(--text);
      background:
        radial-gradient(60% 50% at 50% 0%, oklch(0.82 0.14 165 / 0.09), transparent 70%),
        var(--bg);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    ::selection { background: oklch(0.82 0.14 165 / 0.3); }

    .shell { width: 100%; max-width: 440px; }
    .card {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px 28px 24px;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 24px 60px -20px rgba(0, 0, 0, 0.8);
    }
    .card::before {
      content: '';
      position: absolute;
      inset: 0 24px auto;
      height: 1px;
      background: linear-gradient(90deg, transparent, oklch(0.82 0.14 165 / 0.55), transparent);
    }

    /* Header: Corvo <-> client handshake */
    .link {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0;
      margin-bottom: 24px;
    }
    .tile {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      border: 1px solid var(--border-strong);
      background: var(--raised);
      display: grid;
      place-items: center;
      flex: none;
    }
    .tile img { display: block; width: 34px; height: auto; }
    .tile-client {
      font-family: var(--mono);
      font-size: 20px;
      font-weight: 500;
      color: var(--text);
      text-transform: uppercase;
    }
    .bridge {
      display: flex;
      align-items: center;
      width: 64px;
      color: var(--accent);
    }
    .bridge::before, .bridge::after {
      content: '';
      flex: 1;
      height: 0;
      border-top: 1px dashed var(--accent-border);
    }
    .bridge i {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 4px oklch(0.82 0.14 165 / 0.14);
      margin: 0 6px;
    }

    h1 {
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.25;
      text-align: center;
      text-wrap: balance;
    }
    h1 span { color: var(--accent); }
    .subtitle {
      margin: 8px auto 0;
      max-width: 36ch;
      text-align: center;
      font-size: 14px;
      color: var(--text-2);
      text-wrap: pretty;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 28px 0 10px;
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-3);
    }
    .section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }

    /* Permissions */
    ul.scopes { list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .scope {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--raised);
    }
    .scope-icon {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      flex: none;
      color: var(--accent);
      background: var(--accent-surface);
      border: 1px solid var(--accent-border);
    }
    .scope-icon svg { width: 17px; height: 17px; }
    .scope-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .scope-desc { font-size: 14px; font-weight: 500; color: var(--text); }
    .scope-name { font-family: var(--mono); font-size: 11.5px; color: var(--text-3); overflow-wrap: anywhere; }

    /* Company picker */
    .tenants { display: flex; flex-direction: column; gap: 8px; border: 0; min-width: 0; margin-top: 28px; }
    .tenants > .section-title { margin: 0 0 2px; }
    .tenant { display: block; position: relative; cursor: pointer; }
    .tenant input {
      position: absolute;
      opacity: 0;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      cursor: pointer;
    }
    .tenant-face {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--raised);
      transition: border-color 0.15s, background-color 0.15s;
    }
    .tenant:hover .tenant-face { border-color: var(--border-strong); }
    .avatar {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      flex: none;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-2);
      background: #181918;
      border: 1px solid var(--border-strong);
      text-transform: uppercase;
    }
    .tenant-name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 500; overflow-wrap: anywhere; }
    .radio {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 1.5px solid var(--border-strong);
      display: grid;
      place-items: center;
      flex: none;
      color: #04130d;
      transition: background-color 0.15s, border-color 0.15s;
    }
    .radio svg { width: 12px; height: 12px; opacity: 0; transform: scale(0.6); transition: opacity 0.15s, transform 0.15s; }
    .tenant input:checked + .tenant-face {
      border-color: var(--accent-border);
      background: var(--accent-surface);
    }
    .tenant input:checked + .tenant-face .avatar { color: var(--accent); border-color: var(--accent-border); }
    .tenant input:checked + .tenant-face .radio { background: var(--accent); border-color: var(--accent); }
    .tenant input:checked + .tenant-face .radio svg { opacity: 1; transform: none; }
    .tenant input:focus-visible + .tenant-face { outline: 2px solid var(--accent); outline-offset: 2px; }

    .no-tenants {
      font-size: 14px;
      line-height: 1.5;
      color: var(--danger);
      padding: 14px 16px;
      border: 1px solid var(--danger-border);
      background: var(--danger-surface);
      border-radius: 12px;
    }

    /* Actions */
    .actions { display: flex; gap: 10px; margin-top: 28px; }
    .btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 46px;
      padding: 0 18px;
      border-radius: 12px;
      border: 1px solid transparent;
      font-family: inherit;
      font-size: 14.5px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: background-color 0.15s, border-color 0.15s, transform 0.1s;
    }
    .btn:active { transform: scale(0.985); }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .btn-primary { flex: 1.5; background: var(--accent); color: #04130d; }
    .btn-primary:hover { background: oklch(0.86 0.14 165); }
    .btn-primary:disabled { background: #1a1a1a; color: #6b6b6b; cursor: not-allowed; transform: none; }
    .btn-secondary { background: transparent; color: var(--text-2); border-color: var(--border-strong); }
    .btn-secondary:hover { background: #141414; color: var(--text); }

    .trust {
      display: flex;
      gap: 10px;
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--text-3);
    }
    .trust svg { width: 16px; height: 16px; flex: none; margin-top: 2px; color: var(--text-3); }
    .trust code {
      font-family: var(--mono);
      font-size: 11.5px;
      color: var(--text-2);
      overflow-wrap: anywhere;
    }

    .foot {
      margin-top: 18px;
      text-align: center;
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.06em;
      color: #6b6b6b;
    }

    /* Entrance */
    @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    .card > *, .foot { animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
    .card > :nth-child(2) { animation-delay: 0.05s; }
    .card > :nth-child(3) { animation-delay: 0.1s; }
    .card > :nth-child(4) { animation-delay: 0.15s; }
    .card > :nth-child(5) { animation-delay: 0.2s; }
    .card > :nth-child(6) { animation-delay: 0.25s; }
    .foot { animation-delay: 0.35s; }
    @media (prefers-reduced-motion: reduce) {
      .card > *, .foot { animation: none; }
      * { transition: none !important; }
    }

    @media (max-width: 420px) {
      .card { padding: 26px 18px 20px; border-radius: 18px; }
      .actions { flex-direction: column-reverse; }
      .btn, .btn-primary { flex: none; width: 100%; }
    }
`;

export function renderConsentPage(input: ConsentPageInput): string {
  const escape = htmlEscape;
  const formAction = escape(input.formAction ?? '/mcp/consent');

  const cancelTarget = new URL(input.redirectUri);
  cancelTarget.searchParams.set('error', 'access_denied');
  cancelTarget.searchParams.set('state', input.state);
  const cancelUrl = escape(cancelTarget.toString());
  const redirectHost = escape(cancelTarget.host || cancelTarget.protocol);

  const clientInitial = escape(Array.from(input.clientName.trim())[0] ?? '?');

  const scopeItems = input.scopes
    .map(
      (scope) => `
        <li class="scope">
          <span class="scope-icon">${scope.name.endsWith(':write') ? ICON_WRITE : ICON_READ}</span>
          <span class="scope-body">
            <span class="scope-desc">${escape(scope.description)}</span>
            <span class="scope-name">${escape(scope.name)}</span>
          </span>
        </li>`,
    )
    .join('');

  const preselect = input.tenants.length === 1;
  const tenantItems = input.tenants
    .map(
      (tenant) => `
        <label class="tenant">
          <input
            type="radio"
            name="selected_tenant_id"
            value="${escape(tenant.id)}"
            ${preselect ? 'checked' : ''}
            required
          />
          <span class="tenant-face">
            <span class="avatar" aria-hidden="true">${escape(Array.from(tenant.name.trim())[0] ?? '?')}</span>
            <span class="tenant-name">${escape(tenant.name)}</span>
            <span class="radio" aria-hidden="true">${ICON_CHECK}</span>
          </span>
        </label>`,
    )
    .join('');

  const tenantSection =
    input.tenants.length === 0
      ? `<p class="no-tenants" role="alert">Você não possui nenhuma empresa ativa. Crie ou ingresse em uma empresa para autorizar o acesso.</p>`
      : `<fieldset class="tenants">
        <legend class="section-title" style="width:100%">Empresa</legend>
        ${tenantItems}
      </fieldset>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="no-referrer" />
  <title>Autorizar acesso — ${escape(input.clientName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
  <style>${STYLES}</style>
</head>
<body>
  <div class="shell">
    <main class="card">
      <div class="link" aria-hidden="true">
        <div class="tile"><img src="${CORVO_LOGO_URL}" width="34" height="25" alt="" /></div>
        <div class="bridge"><i></i></div>
        <div class="tile tile-client">${clientInitial}</div>
      </div>

      <div>
        <h1><span>${escape(input.clientName)}</span> quer acessar sua conta Corvo</h1>
        <p class="subtitle">
          Revise as permissões e escolha a empresa que o aplicativo poderá usar.
        </p>
      </div>

      <section aria-labelledby="perm-title">
        <p class="section-title" id="perm-title">Permissões</p>
        <ul class="scopes">${scopeItems}</ul>
      </section>

      <form method="post" action="${formAction}">
        ${tenantSection}
        <input type="hidden" name="state" value="${escape(input.state)}" />
        <input type="hidden" name="redirect_uri" value="${escape(input.redirectUri)}" />
        <input type="hidden" name="code_challenge" value="${escape(input.codeChallenge)}" />
        <input type="hidden" name="code_challenge_method" value="${escape(input.codeChallengeMethod)}" />
        <input type="hidden" name="client_id" value="${escape(input.clientId)}" />
        <input type="hidden" name="scope" value="${escape(input.scopes.map((s) => s.name).join(' '))}" />

        <div class="actions">
          <a class="btn btn-secondary" href="${cancelUrl}">Cancelar</a>
          <button class="btn btn-primary" type="submit" ${input.tenants.length === 0 ? 'disabled' : ''}>
            Autorizar acesso
          </button>
        </div>
      </form>

      <div class="trust">
        ${ICON_SHIELD}
        <p>
          Ao autorizar, você será redirecionado para <code>${redirectHost}</code>.
          Você pode revogar este acesso a qualquer momento nas configurações da Corvo.
        </p>
      </div>
    </main>
    <p class="foot">CORVO · NFS-e POR API</p>
  </div>
</body>
</html>`;
}
