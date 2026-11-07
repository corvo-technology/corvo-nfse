import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType: string;
  }>;
  idempotencyKey?: string;
};

export type SendEmailOutput = {
  id: string;
};

/** The provider refused the message itself (bad address, invalid content): sending it again cannot work. */
export class PermanentEmailError extends Error {}

@Injectable()
export class MillionSendEmailProvider {
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY', '');
    const baseUrl = this.config.get<string>(
      'RESEND_BASE_URL',
      'https://api.resend.com',
    );
    const from = this.config.get<string>(
      'EMAIL_FROM',
      'Corvo <noreply@corvo.tech>',
    );

    if (!apiKey && this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error('RESEND_API_KEY is required in production');
    }
    this.client = apiKey ? new Resend(apiKey, { baseUrl }) : null;
    this.from = from;
  }

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    if (!this.client) {
      throw new Error('RESEND_API_KEY is required to send email');
    }

    const result = await this.client.emails.send(
      {
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.attachments
          ? {
              attachments: input.attachments.map((a) => ({
                filename: a.filename,
                // MillionSend only accepts base64 strings; a raw Buffer is
                // serialized as an object and rejected with a 422.
                content: Buffer.isBuffer(a.content)
                  ? a.content.toString('base64')
                  : a.content,
                contentType: a.contentType,
              })),
            }
          : {}),
      },
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined,
    );

    if (result.error) {
      const message = `MillionSend API error: ${result.error.message}`;
      const status = result.error.statusCode;
      if (status === 400 || status === 422)
        throw new PermanentEmailError(message);
      throw new Error(message);
    }

    if (!result.data?.id) {
      throw new Error(
        `MillionSend returned no email ID: ${JSON.stringify(result)}`,
      );
    }

    return { id: result.data.id };
  }
}
