import type { EmailTemplateRef } from '@/infra/external/email/email-template.client';

export type OtpEmailJobData = {
  emailId: string;
  to: string;
  template: EmailTemplateRef;
  kind: 'otp';
  code: string;
  expiresInMinutes: number;
  productKey: string;
};

export type InvoiceEmailJobData = {
  emailId: string;
  to: string;
  subject: string;
  html: string;
  kind: 'invoice';
  customerName: string;
  customerTaxId: string;
  serviceDescription: string;
  amount: string;
  nfseNumber: number;
  accessKey: string;
  tenantId: string;
  apiKeyEnvironment: 'live' | 'test';
};

export type WelcomeEmailJobData = {
  emailId: string;
  to: string;
  template: EmailTemplateRef;
  kind: 'welcome';
};

export type EmailJobData =
  | OtpEmailJobData
  | InvoiceEmailJobData
  | WelcomeEmailJobData;
