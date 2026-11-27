import { parseEnvConfig } from './env.schema';
import { AppConfiguration } from './configuration.types';
export type {
  AppConfig,
  AppConfiguration,
  DatabaseConfig,
} from './configuration.types';
export type { WorkerConfig } from './configuration.types';
export type { LoggingConfig, OpenTelemetryConfig } from './configuration.types';
export type { SentryConfig } from './configuration.types';
export type {
  QueueConfig,
  RedisConfig,
  OutboxConfig,
} from './configuration.types';
export type { FiscalConfig } from './configuration.types';
export type { RtcConfig } from './configuration.types';
export type { AuthConfig } from './configuration.types';
export type { StorageConfig } from './configuration.types';
export type { PaymentsConfig, StripeConfig } from './configuration.types';
export type { TurnstileConfig } from './configuration.types';
export type { MetaConfig, WhatsAppConfig } from './configuration.types';
export type { OpenApiConfig } from './configuration.types';
export type { OtpConfig } from './configuration.types';
export type { ReferralsConfig } from './configuration.types';
export type { MagicLinkConfig } from './configuration.types';

export default function configuration(): AppConfiguration {
  const env = parseEnvConfig(process.env);

  const config = {
    app: {
      name: env.APP_NAME,
      version: env.APP_VERSION,
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      apiPrefix: env.API_PREFIX.replace(/^\/+|\/+$/g, ''),
      corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
      publicApiUrl: env.PUBLIC_API_URL,
    },
    worker: {
      port: env.WORKER_PORT,
    },
    openApi: {
      enabled: env.OPENAPI_ENABLED ?? env.NODE_ENV !== 'production',
      path: normalizePath(env.OPENAPI_PATH),
      jsonPath: normalizePath(env.OPENAPI_JSON_PATH),
    },
    database: {
      url: env.DATABASE_URL,
      schema: env.DB_SCHEMA,
      ssl: env.DB_SSL,
      sslRejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
      sslCa: env.DB_SSL_CA,
      logging: env.DB_LOGGING,
      manualInitialization: env.NODE_ENV === 'test',
      pool: {
        max: env.DB_POOL_MAX,
        min: env.DB_POOL_MIN,
        idleTimeoutMs: env.DB_POOL_IDLE_TIMEOUT_MS,
        connectionTimeoutMs: env.DB_POOL_CONNECTION_TIMEOUT_MS,
        maxLifetimeSeconds: env.DB_POOL_MAX_LIFETIME_SECONDS,
      },
      statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
      applicationName: env.DB_APPLICATION_NAME,
    },
    auth: {
      jwtSecret: env.AUTH_JWT_SECRET,
      accessTokenTtlSeconds: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: env.AUTH_REFRESH_TOKEN_TTL_DAYS,
      authorizationCodeTtlSeconds: env.AUTH_AUTHORIZATION_CODE_TTL_SECONDS,
      csrfSigningSecret: env.AUTH_CSRF_SIGNING_SECRET,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUrl: env.GOOGLE_REDIRECT_URL,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      redirectUrl: env.GITHUB_REDIRECT_URL,
    },
    publicCustomerSession: {
      enforced: env.PUBLIC_CUSTOMER_SESSION_ENFORCED,
      hmacSecret:
        env.PUBLIC_CUSTOMER_SESSION_HMAC_SECRET ?? env.AUTH_CSRF_SIGNING_SECRET,
      idleTtlDays: env.PUBLIC_CUSTOMER_SESSION_IDLE_TTL_DAYS,
      absoluteTtlDays: env.PUBLIC_CUSTOMER_SESSION_ABSOLUTE_TTL_DAYS,
      touchIntervalHours: env.PUBLIC_CUSTOMER_SESSION_TOUCH_INTERVAL_HOURS,
      maxActiveDevices: env.PUBLIC_CUSTOMER_SESSION_MAX_ACTIVE_DEVICES,
    },
    redis: {
      url: env.REDIS_URL,
      keyPrefix: env.REDIS_KEY_PREFIX,
      cacheDefaultTtlSeconds: env.REDIS_CACHE_DEFAULT_TTL_SECONDS,
    },
    queue: {
      defaultAttempts: env.QUEUE_DEFAULT_ATTEMPTS,
      defaultBackoffMs: env.QUEUE_DEFAULT_BACKOFF_MS,
      nfseEmissionConcurrency: env.NFSE_EMISSION_CONCURRENCY,
    },
    fiscalPortal: {
      breakerThreshold: env.NFSE_PORTAL_BREAKER_THRESHOLD,
      breakerCooldownMs: env.NFSE_PORTAL_BREAKER_COOLDOWN_MS,
      uncertainMaxHours: env.NFSE_UNCERTAIN_MAX_HOURS,
    },
    govRateLimit: {
      perSecond: env.GOV_RATE_LIMIT_PER_SECOND,
      burst: env.GOV_RATE_LIMIT_BURST,
      maxWaitMs: env.GOV_RATE_LIMIT_MAX_WAIT_MS,
    },
    docsRecovery: { maxPerRun: env.DOCS_RECOVERY_MAX_PER_RUN },
    outbox: {
      relayIntervalMs: env.OUTBOX_RELAY_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
      leaseMs: env.OUTBOX_LEASE_MS,
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
      scheduleMaxDays: env.OUTBOX_SCHEDULE_MAX_DAYS,
    },
    fiscal: {
      ibsCbsUnavailableMode: env.FISCAL_IBSCBS_UNAVAILABLE_MODE,
    },
    rtc: {
      url: env.RTC_CALCULATOR_URL,
      timeoutMs: env.RTC_CALCULATOR_TIMEOUT_MS,
      maxConcurrency: env.RTC_CALCULATOR_MAX_CONCURRENCY,
      circuitFailureThreshold: env.RTC_CIRCUIT_FAILURE_THRESHOLD,
      circuitResetMs: env.RTC_CIRCUIT_RESET_MS,
      dpsLayout: env.FISCAL_DPS_LAYOUT,
      nt009CutoverAt: env.FISCAL_NT009_CUTOVER_AT,
      expectedVersion: env.RTC_EXPECTED_VERSION,
    },
    logging: {
      level: env.LOG_LEVEL,
      pretty: env.LOG_PRETTY && env.NODE_ENV !== 'production',
    },
    openTelemetry: {
      enabled: env.OTEL_ENABLED,
      serviceName: env.OTEL_SERVICE_NAME ?? env.APP_NAME,
      exporterOtlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      sampleRatio: env.OTEL_SAMPLE_RATIO,
    },
    sentry: {
      enabled: env.SENTRY_ENABLED,
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      release: env.SENTRY_RELEASE ?? env.APP_VERSION,
      errorSampleRate: env.SENTRY_ERROR_SAMPLE_RATE,
      debug: env.SENTRY_DEBUG,
      flushTimeoutMs: env.SENTRY_FLUSH_TIMEOUT_MS,
      captureDisconnects: env.SENTRY_CAPTURE_DISCONNECTS,
    },
    payments: {
      allowedProviders: env.PAYMENT_ALLOWED_PROVIDERS.split(',')
        .map((provider) => provider.trim())
        .filter(Boolean) as Array<'stripe' | 'woovi'>,
      defaultProvider: env.PAYMENT_DEFAULT_PROVIDER,
    },
    woovi: {
      enabled: env.PAYMENT_ALLOWED_PROVIDERS.split(',')
        .map((provider) => provider.trim())
        .includes('woovi'),
      appId: env.WOOVI_APP_ID ?? '',
      webhookToken: env.WOOVI_WEBHOOK_TOKEN ?? '',
      apiUrl: env.WOOVI_API_URL,
    },
    stripe: {
      enabled: env.PAYMENT_ALLOWED_PROVIDERS.split(',')
        .map((provider) => provider.trim())
        .includes('stripe'),
      secretKey: env.STRIPE_SECRET_KEY ?? '',
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',
      platformWebhookSecret: env.STRIPE_PLATFORM_WEBHOOK_SECRET ?? '',
      portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID ?? '',
      connectWebhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET ?? '',
      accountsV2WebhookSecret: env.STRIPE_ACCOUNTS_V2_WEBHOOK_SECRET ?? '',
      checkoutSuccessUrl: env.STRIPE_CHECKOUT_SUCCESS_URL,
      checkoutCancelUrl: env.STRIPE_CHECKOUT_CANCEL_URL,
      connectReturnUrl: env.STRIPE_CONNECT_RETURN_URL,
      connectRefreshUrl: env.STRIPE_CONNECT_REFRESH_URL,
    },
    turnstile: {
      secretKey: env.TURNSTILE_SECRET_KEY ?? '',
      allowedHostnames: env.TURNSTILE_ALLOWED_HOSTNAMES.split(',')
        .map((hostname) => hostname.trim().toLowerCase())
        .filter(Boolean),
      developmentBypassEnabled: env.TURNSTILE_DEVELOPMENT_BYPASS_ENABLED,
    },
    storage: {
      provider: env.STORAGE_PROVIDER,
      s3Bucket: env.STORAGE_S3_BUCKET,
      s3Endpoint: env.STORAGE_S3_ENDPOINT,
      s3Region: env.STORAGE_S3_REGION,
      s3AccessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
      s3SecretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
      s3ForcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
      publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
    },
    whatsapp: {
      webhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '',
      twoStepPin: env.WHATSAPP_TWO_STEP_PIN ?? '',
      allowedProviders: env.WHATSAPP_ALLOWED_PROVIDERS.split(',').map(
        (value) => value.trim() as 'meta' | 'waha',
      ),
    },
    meta: {
      appId: env.META_APP_ID ?? '',
      appSecret: env.META_APP_SECRET ?? '',
      configId: env.META_CONFIG_ID ?? '',
      graphApiBaseUrl: env.META_GRAPH_API_BASE_URL,
      graphApiVersion: env.META_GRAPH_API_VERSION,
      secretsEncryptionKey: env.SECRETS_ENCRYPTION_KEY ?? '',
    },
    otp: {
      hmacSecret:
        env.OTP_HMAC_SECRET ?? 'test-otp-hmac-secret-at-least-32-characters',
      ttlSeconds: env.OTP_TTL_SECONDS,
      proofTtlSeconds: env.OTP_PROOF_TTL_SECONDS,
      maxAttempts: env.OTP_MAX_ATTEMPTS,
      resendCooldownSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
      issueWindowSeconds: env.OTP_ISSUE_WINDOW_SECONDS,
      maxIssuesPerChannelWindow: env.OTP_MAX_ISSUES_PER_CHANNEL_WINDOW,
      maxIssuesPerSubjectWindow: env.OTP_MAX_ISSUES_PER_SUBJECT_WINDOW,
      maxIssuesPerIpWindow: env.OTP_MAX_ISSUES_PER_IP_WINDOW,
      metaPhoneNumberId: env.OTP_META_PHONE_NUMBER_ID,
      metaAccessToken: env.OTP_META_ACCESS_TOKEN,
      otpTemplate: env.OTP_TEMPLATE_NAME,
      otpTemplateLanguage: env.OTP_TEMPLATE_LANGUAGE,
      metaGraphVersion: env.OTP_META_GRAPH_VERSION,
    },
    referrals: {
      establishmentAffiliateCommissions: {
        annualSalePercent: env.REFERRAL_ANNUAL_SALE_PERCENT ?? 10,
        monthlySalePercent: env.REFERRAL_MONTHLY_SALE_PERCENT ?? 5,
        monthlyRecurringPercent: env.REFERRAL_MONTHLY_RECURRING_PERCENT ?? 3,
      },
    },
    magicLink: {
      codeTtlMinutes: env.MAGIC_LINK_CODE_TTL_MINUTES,
      maxAttemptsPerHour: env.MAGIC_LINK_MAX_ATTEMPTS_PER_HOUR,
    },
  };

  return config;
}

function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizePath(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
