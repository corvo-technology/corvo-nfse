import type { RenderedEmail } from '@/infra/external/email/email-templates';

export type OtpEmailJobData = {
  emailId: string;
  to: string;
  email: RenderedEmail;
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
  email: RenderedEmail;
  kind: 'welcome';
};

export type CreditsLowEmailJobData = {
  emailId: string;
  to: string;
  email: RenderedEmail;
  kind: 'credits-low';
};

export type ScheduleRetryEmailJobData = {
  emailId: string;
  to: string;
  email: RenderedEmail;
  kind: 'schedule-retry';
};

export type SchedulePausedEmailJobData = {
  emailId: string;
  to: string;
  email: RenderedEmail;
  kind: 'schedule-paused';
};

export type EmailJobData =
  | OtpEmailJobData
  | InvoiceEmailJobData
  | WelcomeEmailJobData
  | CreditsLowEmailJobData
  | ScheduleRetryEmailJobData
  | SchedulePausedEmailJobData;
