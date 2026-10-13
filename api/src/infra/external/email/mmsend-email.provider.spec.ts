import { ConfigService } from '@nestjs/config';

// Mock before importing the module under test
const mockEmailsSend = jest
  .fn()
  .mockResolvedValue({ data: { id: 'email_123' } });

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: mockEmailsSend,
    },
  })),
}));

import { MillionSendEmailProvider } from './mmsend-email.provider';

describe('MillionSendEmailProvider', () => {
  const mockConfig = {
    get: jest.fn((key: string): string => {
      const map: Record<string, string> = {
        RESEND_API_KEY: 'ms_test_key',
        RESEND_BASE_URL: 'https://api.millionsend.com',
        EMAIL_FROM: 'Corvo <noreply@corvo.com>',
      };
      return map[key] ?? '';
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends email via resend with correct payload', async () => {
    const provider = new MillionSendEmailProvider(
      mockConfig as unknown as ConfigService,
    );
    const result = await provider.send({
      to: ['user@example.com'],
      subject: 'Test',
      html: '<p>Hello</p>',
    });
    expect(result.id).toBe('email_123');
  });

  it('throws when resend returns an error object with no id', async () => {
    mockEmailsSend.mockResolvedValueOnce({
      data: null,
      error: { message: 'bad' },
    });
    const provider = new MillionSendEmailProvider(
      mockConfig as unknown as ConfigService,
    );
    await expect(
      provider.send({
        to: ['user@example.com'],
        subject: 'Test',
        html: '<p>Hi</p>',
      }),
    ).rejects.toThrow('MillionSend API error: bad');
  });

  it('boots locally without a key and fails explicitly when sending', async () => {
    const config = {
      get: (key: string, fallback?: string) =>
        key === 'NODE_ENV' ? 'development' : fallback,
    } as ConfigService;
    const provider = new MillionSendEmailProvider(config);

    await expect(
      provider.send({
        to: ['user@example.com'],
        subject: 'Test',
        html: '<p>Hi</p>',
      }),
    ).rejects.toThrow('RESEND_API_KEY is required to send email');
    expect(mockEmailsSend).not.toHaveBeenCalled();
  });

  it('sends email with attachments', async () => {
    const provider = new MillionSendEmailProvider(
      mockConfig as unknown as ConfigService,
    );
    const buffer = Buffer.from('PDF content');
    await provider.send({
      to: ['user@example.com'],
      subject: 'Invoice',
      html: '<p>Your invoice</p>',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: buffer,
          contentType: 'application/pdf',
        },
      ],
    });
    expect(mockEmailsSend).toHaveBeenCalledWith(
      {
        from: 'Corvo <noreply@corvo.com>',
        to: ['user@example.com'],
        subject: 'Invoice',
        html: '<p>Your invoice</p>',
        attachments: [
          {
            filename: 'invoice.pdf',
            content: buffer.toString('base64'),
            contentType: 'application/pdf',
          },
        ],
      },
      undefined,
    );
  });

  it('passes string attachment content through unchanged', async () => {
    const provider = new MillionSendEmailProvider(
      mockConfig as unknown as ConfigService,
    );
    await provider.send({
      to: ['user@example.com'],
      subject: 'Invoice',
      html: '<p>Your invoice</p>',
      attachments: [
        {
          filename: 'invoice.xml',
          content: 'PHhtbC8+',
          contentType: 'application/xml',
        },
      ],
    });
    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: 'invoice.xml',
            content: 'PHhtbC8+',
            contentType: 'application/xml',
          },
        ],
      }),
      undefined,
    );
  });

  it('sends email with idempotency key', async () => {
    const provider = new MillionSendEmailProvider(
      mockConfig as unknown as ConfigService,
    );
    await provider.send({
      to: ['user@example.com'],
      subject: 'Test',
      html: '<p>Hello</p>',
      idempotencyKey: 'unique-key-123',
    });
    expect(mockEmailsSend).toHaveBeenCalledWith(
      {
        from: 'Corvo <noreply@corvo.com>',
        to: ['user@example.com'],
        subject: 'Test',
        html: '<p>Hello</p>',
      },
      { idempotencyKey: 'unique-key-123' },
    );
  });

  it('sends email with both attachments and idempotency key', async () => {
    const provider = new MillionSendEmailProvider(
      mockConfig as unknown as ConfigService,
    );
    const buffer = Buffer.from('PDF content');
    await provider.send({
      to: ['user@example.com'],
      subject: 'Invoice',
      html: '<p>Your invoice</p>',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: buffer,
          contentType: 'application/pdf',
        },
      ],
      idempotencyKey: 'unique-key-456',
    });
    expect(mockEmailsSend).toHaveBeenCalledWith(
      {
        from: 'Corvo <noreply@corvo.com>',
        to: ['user@example.com'],
        subject: 'Invoice',
        html: '<p>Your invoice</p>',
        attachments: [
          {
            filename: 'invoice.pdf',
            content: buffer.toString('base64'),
            contentType: 'application/pdf',
          },
        ],
      },
      { idempotencyKey: 'unique-key-456' },
    );
  });

  it('throws when resend returns an error object even with an id present', async () => {
    mockEmailsSend.mockResolvedValueOnce({
      data: { id: 'email_123' },
      error: { message: 'Spam detected' },
    });
    const provider = new MillionSendEmailProvider(
      mockConfig as unknown as ConfigService,
    );
    await expect(
      provider.send({
        to: ['user@example.com'],
        subject: 'Test',
        html: '<p>Hi</p>',
      }),
    ).rejects.toThrow('MillionSend API error: Spam detected');
  });

  it('throws when resend returns no id and no error object', async () => {
    mockEmailsSend.mockResolvedValueOnce({
      data: {},
      error: null,
    });
    const provider = new MillionSendEmailProvider(
      mockConfig as unknown as ConfigService,
    );
    await expect(
      provider.send({
        to: ['user@example.com'],
        subject: 'Test',
        html: '<p>Hi</p>',
      }),
    ).rejects.toThrow('MillionSend returned no email ID');
  });

  it('rejects missing email credentials in production at boot', () => {
    const config = {
      get: (key: string, fallback?: string) =>
        key === 'NODE_ENV' ? 'production' : fallback,
    } as ConfigService;

    expect(() => new MillionSendEmailProvider(config)).toThrow(
      'RESEND_API_KEY is required in production',
    );
  });
});
