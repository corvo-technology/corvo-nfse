export type AppConfig = {
  name: string;
  version: string;
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  publicApiUrl?: string;
};

export type WorkerConfig = {
  port: number;
};

export type DatabaseConfig = {
  url: string;
  schema: string;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
  sslCa?: string;
  logging: boolean;
  manualInitialization: boolean;
  pool: {
    max: number;
    min: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    maxLifetimeSeconds: number;
  };
  statementTimeoutMs: number;
  applicationName: string;
};

export type RedisConfig = {
  url: string;
  keyPrefix: string;
  cacheDefaultTtlSeconds: number;
};

export type QueueConfig = {
  defaultAttempts: number;
  defaultBackoffMs: number;
  /** Invoices sent to the fiscal portal at the same time by each worker process. */
  nfseEmissionConcurrency: number;
  /** Jobs each test (`*-test`) queue runs at the same time per worker process. */
  testQueueConcurrency: number;
};

/** Brake on calls to government hosts (per host, shared by every replica). */
export type GovRateLimitConfig = {
  /** Sustained requests per second per host. */
  perSecond: number;
  /** Requests allowed at once after a quiet moment. */
  burst: number;
  /** How long a caller waits for a token before the job is delayed instead. */
  maxWaitMs: number;
};

/** How the worker reacts when the national NFS-e portal stops answering. */
export type FiscalPortalConfig = {
  /** Unanswered calls in a row that pause emission. */
  breakerThreshold: number;
  /** Pause before the next trial call to the portal. */
  breakerCooldownMs: number;
  /** An invoice without a conclusive answer for longer than this goes to manual review. */
  uncertainMaxHours: number;
};

export interface OutboxConfig {
  relayIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  scheduleMaxDays: number;
}

export interface FiscalConfig {
  ibsCbsUnavailableMode: 'block' | 'warn';
}

export type RtcDpsLayout = 'rtc-v1.01' | 'nt009-r1' | 'auto';

export interface RtcConfig {
  url?: string;
  timeoutMs: number;
  maxConcurrency: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
  dpsLayout: RtcDpsLayout;
  nt009CutoverAt?: string;
  /** Versão fixada `"{versaoApp}/{versaoDb}"` para detectar updates publicados. */
  expectedVersion?: string;
}

export type OpenApiConfig = {
  enabled: boolean;
  path: string;
  jsonPath: string;
};

export type AuthConfig = {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  authorizationCodeTtlSeconds: number;
  csrfSigningSecret: string;
};

export type OAuthProviderConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUrl?: string;
};

export type PublicCustomerSessionConfig = {
  enforced: boolean;
  hmacSecret: string;
  idleTtlDays: number;
  absoluteTtlDays: number;
  touchIntervalHours: number;
  maxActiveDevices: number;
};

export type StorageConfig = {
  provider: 'unavailable' | 's3' | 'local';
  s3Bucket: string;
  s3Endpoint?: string;
  s3Region: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle: boolean;
  publicBaseUrl?: string;
};

export type WhatsAppConfig = {
  webhookVerifyToken: string;
  twoStepPin: string;
  allowedProviders: Array<'meta' | 'waha'>;
};

export type MetaConfig = {
  appId: string;
  appSecret: string;
  configId: string;
  graphApiBaseUrl: string;
  graphApiVersion: string;
  secretsEncryptionKey: string;
};

export type WooviConfig = {
  enabled: boolean;
  appId: string;
  webhookToken: string;
  apiUrl: string;
};

export type StripeConfig = {
  enabled: boolean;
  secretKey: string;
  publishableKey: string;
  platformWebhookSecret: string;
  portalConfigurationId: string;
  connectWebhookSecret: string;
  accountsV2WebhookSecret: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  connectReturnUrl: string;
  connectRefreshUrl: string;
};

export type LifecycleEmailsConfig = {
  enabled: boolean;
  firstInvoice: boolean;
  monthlySummary: boolean;
  creditsForecast: boolean;
  pendingPayment: boolean;
  rejectionHelp: boolean;
};

export type PaymentsConfig = {
  allowedProviders: Array<'stripe' | 'woovi'>;
  defaultProvider: 'stripe' | 'woovi';
};

export type TurnstileConfig = {
  secretKey: string;
  allowedHostnames: string[];
  developmentBypassEnabled: boolean;
};

export type LoggingConfig = {
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  pretty: boolean;
};

export type OpenTelemetryConfig = {
  enabled: boolean;
  serviceName: string;
  exporterOtlpEndpoint?: string;
  sampleRatio: number;
};

export type SentryConfig = {
  enabled: boolean;
  dsn?: string;
  environment: string;
  release?: string;
  errorSampleRate: number;
  debug: boolean;
  flushTimeoutMs: number;
  captureDisconnects: boolean;
};

export type OtpConfig = {
  hmacSecret: string;
  ttlSeconds: number;
  proofTtlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  issueWindowSeconds: number;
  maxIssuesPerChannelWindow: number;
  maxIssuesPerSubjectWindow: number;
  maxIssuesPerIpWindow: number;
  metaPhoneNumberId?: string;
  metaAccessToken?: string;
  otpTemplate: string;
  otpTemplateLanguage: string;
  metaGraphVersion: string;
};

export type ReferralsConfig = {
  establishmentAffiliateCommissions: {
    annualSalePercent: number;
    monthlySalePercent: number;
    monthlyRecurringPercent: number;
  };
};

export type MagicLinkConfig = {
  codeTtlMinutes: number;
  maxAttemptsPerHour: number;
};

export type AppConfiguration = {
  app: AppConfig;
  worker: WorkerConfig;
  openApi: OpenApiConfig;
  auth: AuthConfig;
  google: OAuthProviderConfig;
  github: OAuthProviderConfig;
  publicCustomerSession: PublicCustomerSessionConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  queue: QueueConfig;
  outbox: OutboxConfig;
  webhooks: { retryIntervalMs: number };
  fiscal: FiscalConfig;
  rtc: RtcConfig;
  logging: LoggingConfig;
  openTelemetry: OpenTelemetryConfig;
  sentry: SentryConfig;
  stripe: StripeConfig;
  woovi: WooviConfig;
  lifecycleEmails: LifecycleEmailsConfig;
  payments: PaymentsConfig;
  turnstile: TurnstileConfig;
  storage: StorageConfig;
  whatsapp: WhatsAppConfig;
  meta: MetaConfig;
  otp: OtpConfig;
  referrals: ReferralsConfig;
  magicLink: MagicLinkConfig;
};
