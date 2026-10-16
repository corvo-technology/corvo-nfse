import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EmailTemplateAlias =
  | 'otp-code'
  | 'welcome'
  | 'nfse-documents-ready'
  | 'credits-low';

export type EmailTemplateRef = {
  alias: EmailTemplateAlias;
  variables: Record<string, string>;
};

export type RenderedEmail = { subject: string; html: string };

type CachedTemplate = {
  subject: string;
  html: string;
  fetchedAt: number;
};

const CACHE_TTL_MS = 5 * 60_000;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Replaces `{{name}}` placeholders with HTML-escaped values.
 * Throws when a placeholder has no value so a typo never ships a broken email.
 */
function renderPlaceholders(
  source: string,
  vars: Record<string, string>,
): string {
  return source.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Missing email template variable: ${key}`);
    }
    return vars[key].replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  });
}

/**
 * MillionSend cannot send "by template" (its send API only takes html/text),
 * so the template is fetched by alias, filled in here and sent as html.
 * Templates stay editable in the MillionSend dashboard without a deploy.
 */
@Injectable()
export class MillionSendTemplateClient {
  private readonly logger = new Logger(MillionSendTemplateClient.name);
  private readonly cache = new Map<string, CachedTemplate>();

  constructor(private readonly config: ConfigService) {}

  async render(ref: EmailTemplateRef): Promise<RenderedEmail> {
    const template = await this.load(ref.alias);
    return {
      subject: renderPlaceholders(template.subject, ref.variables),
      html: renderPlaceholders(template.html, ref.variables),
    };
  }

  private async load(alias: string): Promise<CachedTemplate> {
    const cached = this.cache.get(alias);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

    try {
      const fresh = await this.fetchTemplate(alias);
      this.cache.set(alias, fresh);
      return fresh;
    } catch (err) {
      if (cached) {
        this.logger.warn(
          `Using stale "${alias}" template: ${err instanceof Error ? err.message : String(err)}`,
        );
        return cached;
      }
      throw err;
    }
  }

  private async fetchTemplate(alias: string): Promise<CachedTemplate> {
    const apiKey = this.config.get<string>('RESEND_API_KEY', '');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required to load email templates');
    }
    const baseUrl = this.config.get<string>(
      'RESEND_BASE_URL',
      'https://api.resend.com',
    );

    const response = await fetch(
      `${baseUrl}/templates/${encodeURIComponent(alias)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!response.ok) {
      throw new Error(
        `MillionSend template "${alias}" fetch failed: ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      subject?: string | null;
      html?: string | null;
    };
    if (!body.html) {
      throw new Error(`MillionSend template "${alias}" has no html`);
    }
    return {
      subject: body.subject ?? '',
      html: body.html,
      fetchedAt: Date.now(),
    };
  }
}
