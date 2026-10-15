import { z } from 'zod';
import { booleanFromEnv } from './boolean-env.schema';

export const envSchema = z
  .object({
    APP_NAME: z.string().min(1).default('corvo-backend'),
    APP_VERSION: z.string().min(1).default('0.0.1'),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    WORKER_PORT: z.coerce.number().int().positive().default(3002),
    NFSE_MASTER_KEY: z.string().min(32).optional(),
    RESEND_API_KEY: z.string().trim().optional(),
    RESEND_BASE_URL: z.string().url().default('https://api.resend.com'),
    EMAIL_FROM: z.string().min(1).default('Corvo <noreply@corvo.tech>'),
    // ─── WhatsApp Pacing ──────────────────────────────────────────
    WHATSAPP_PACING_DELAY_MIN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(8000),
    WHATSAPP_PACING_DELAY_MAX_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(18000),
    WHATSAPP_PACING_TENANT_LIMIT: z.coerce.number().int().positive().default(6),
    WHATSAPP_PACING_TENANT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),
    WHATSAPP_PACING_RECIPIENT_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    WHATSAPP_PACING_RECIPIENT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(300000),
    WHATSAPP_PACING_WARMUP_DAYS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(7),
    WHATSAPP_PACING_WARMUP_DAY_ONE_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    WHATSAPP_PACING_WARMUP_DAILY_INCREMENT: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(10),
    WHATSAPP_PACING_WARMUP_MAX_DAILY_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(80),
    WHATSAPP_PACING_FAIL_OPEN: booleanFromEnv.default(false),
    WHATSAPP_PACING_TENANT_LIMIT_HIGH: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    WHATSAPP_PACING_TENANT_LIMIT_LOW: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    WHATSAPP_PACING_RECIPIENT_LIMIT_HIGH: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    WHATSAPP_PACING_RECIPIENT_LIMIT_LOW: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    WHATSAPP_PACING_HIGH_DELAY_MIN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(2000),
    WHATSAPP_PACING_HIGH_DELAY_MAX_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(5000),
    WHATSAPP_PACING_LOW_DELAY_MIN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(30000),
    WHATSAPP_PACING_LOW_DELAY_MAX_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60000),
    WHATSAPP_PACING_LOW_RECIPIENT_DELAY_MIN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60000),
    WHATSAPP_PACING_LOW_RECIPIENT_DELAY_MAX_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(120000),
    WHATSAPP_PACING_PROACTIVE_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(3600000),
    WHATSAPP_PACING_LEASE_TTL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120000),
    WHATSAPP_PACING_HIGH_TENANT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),
    WHATSAPP_PACING_HIGH_RECIPIENT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),
    WHATSAPP_PACING_LOW_TENANT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(3600000),
    WHATSAPP_PACING_LOW_RECIPIENT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(86400000),
    API_PREFIX: z.string().min(1).default('v1'),
    OPENAPI_ENABLED: booleanFromEnv.optional(),
    OPENAPI_PATH: z.string().min(1).default('docs'),
    OPENAPI_JSON_PATH: z.string().min(1).default('docs-json'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    AUTH_JWT_SECRET: z.string().min(32),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    AUTH_AUTHORIZATION_CODE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    AUTH_CSRF_SIGNING_SECRET: z.string().min(32),
    PUBLIC_CUSTOMER_SESSION_ENFORCED: booleanFromEnv.default(false),
    PUBLIC_CUSTOMER_SESSION_HMAC_SECRET: z.string().min(32).optional(),
    PUBLIC_CUSTOMER_SESSION_IDLE_TTL_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(30),
    PUBLIC_CUSTOMER_SESSION_ABSOLUTE_TTL_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(180),
    PUBLIC_CUSTOMER_SESSION_TOUCH_INTERVAL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .default(24),
    PUBLIC_CUSTOMER_SESSION_MAX_ACTIVE_DEVICES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3),
    TURNSTILE_ALLOWED_HOSTNAMES: z.string().min(1).default('localhost'),
    TURNSTILE_DEVELOPMENT_BYPASS_ENABLED: booleanFromEnv.default(false),
    DATABASE_URL: z.string().min(1),
    DB_SCHEMA: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      .default('corvo'),
    DB_SSL: booleanFromEnv.default(false),
    DB_LOGGING: booleanFromEnv.default(false),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_POOL_MIN: z.coerce.number().int().min(0).max(100).default(0),
    DB_POOL_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(30000),
    DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(3000),
    DB_POOL_MAX_LIFETIME_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(1800),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(0),
    DB_APPLICATION_NAME: z.string().min(1).default('corvo'),
    DB_CHECKPOINT_APPLICATION_NAME: z
      .string()
      .min(1)
      .default('corvo-checkpoint'),
    RATE_LIMIT_AUTHENTICATED: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_PUBLIC: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_PRE_AUTH: z.coerce.number().int().positive().default(1200),
    RATE_LIMIT_STRIPE_WEBHOOK: z.coerce.number().int().positive().default(600),
    REDIS_URL: z.string().min(1),
    REDIS_KEY_PREFIX: z.string().min(1).default('corvo'),
    REDIS_CACHE_DEFAULT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    QUEUE_DEFAULT_ATTEMPTS: z.coerce.number().int().positive().default(3),
    QUEUE_DEFAULT_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    OUTBOX_LEASE_MS: z.coerce.number().int().positive().default(120000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    OUTBOX_SCHEDULE_MAX_DAYS: z.coerce.number().int().positive().default(15),
    FISCAL_IBSCBS_UNAVAILABLE_MODE: z.enum(['block', 'warn']).default('block'),
    RTC_CALCULATOR_URL: z.string().url().optional(),
    RTC_CALCULATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    RTC_CALCULATOR_MAX_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .default(8),
    RTC_CIRCUIT_FAILURE_THRESHOLD: z.coerce
      .number()
      .int()
      .positive()
      .default(5),
    RTC_CIRCUIT_RESET_MS: z.coerce.number().int().positive().default(30000),
    FISCAL_DPS_LAYOUT: z.enum(['rtc-v1.01']).default('rtc-v1.01'),
    WHATSAPP_SEND_ATTEMPTS: z.coerce.number().int().positive().default(3),
    WHATSAPP_SEND_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    WHATSAPP_RECEIVE_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    WHATSAPP_SEND_CONCURRENCY: z.coerce.number().int().positive().default(10),
    APP_URL: z.string().url().optional(),
    PUBLIC_API_URL: z.string().url().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFromEnv.default(false),
    OTEL_ENABLED: booleanFromEnv.default(false),
    OTEL_SERVICE_NAME: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(1),
    SENTRY_ENABLED: booleanFromEnv.default(false),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    SENTRY_RELEASE: z.string().min(1).optional(),
    SENTRY_ERROR_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    SENTRY_DEBUG: booleanFromEnv.default(false),
    SENTRY_FLUSH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(60_000)
      .default(2000),
    SENTRY_CAPTURE_DISCONNECTS: booleanFromEnv.default(true),
    PAYMENT_ALLOWED_PROVIDERS: z.string().default('stripe'),
    PAYMENT_DEFAULT_PROVIDER: z.enum(['stripe']).default('stripe'),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    STRIPE_PORTAL_CONFIGURATION_ID: z.string().min(1).optional(),
    STRIPE_PLATFORM_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_CONNECT_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_ACCOUNTS_V2_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_CHECKOUT_SUCCESS_URL: z
      .string()
      .url()
      .default('http://localhost:8080/app/billing/success'),
    STRIPE_CHECKOUT_CANCEL_URL: z
      .string()
      .url()
      .default('http://localhost:8080/app/billing/cancel'),
    STRIPE_CONNECT_RETURN_URL: z
      .string()
      .url()
      .default('http://localhost:8080/app/settings/payments/stripe/return'),
    STRIPE_CONNECT_REFRESH_URL: z
      .string()
      .url()
      .default('http://localhost:8080/app/settings/payments/stripe/refresh'),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    STORAGE_PROVIDER: z.enum(['unavailable', 's3']).default('unavailable'),
    STORAGE_S3_BUCKET: z.string().min(1).default('corvo-nfse'),
    STORAGE_S3_ENDPOINT: z.string().url().optional(),
    STORAGE_S3_REGION: z.string().min(1).default('auto'),
    STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    STORAGE_S3_FORCE_PATH_STYLE: booleanFromEnv.default(true),
    STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
    WHATSAPP_TWO_STEP_PIN: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    WHATSAPP_ALLOWED_PROVIDERS: z
      .string()
      .default('meta')
      .refine(
        (value) =>
          value
            .split(',')
            .map((item) => item.trim())
            .every((item) => item === 'meta' || item === 'waha'),
        'WHATSAPP_ALLOWED_PROVIDERS accepts only meta and waha',
      ),
    META_APP_ID: z.string().min(1).optional(),
    META_APP_SECRET: z.string().min(1).optional(),
    META_CONFIG_ID: z.string().min(1).optional(),
    META_GRAPH_API_BASE_URL: z
      .string()
      .url()
      .default('https://graph.facebook.com'),
    META_GRAPH_API_VERSION: z.string().min(1).default('v25.0'),
    SECRETS_ENCRYPTION_KEY: z.string().min(1).optional(),
    // ─── OAuth Providers ──────────────────────────────────────────
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URL: z.string().url().optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_REDIRECT_URL: z.string().url().optional(),
    DASHBOARD_URL: z.string().url().optional(),
    MCP_REDIRECT_URIS: z.string().min(1).optional(),
    // ─── Magic Link ───────────────────────────────────────────────
    MAGIC_LINK_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(10),
    MAGIC_LINK_MAX_ATTEMPTS_PER_HOUR: z.coerce
      .number()
      .int()
      .positive()
      .default(5),
    // ─── OTP Configuration ────────────────────────────────────────
    OTP_HMAC_SECRET: z.string().min(32).optional(),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_PROOF_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(900)
      .default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60),
    OTP_ISSUE_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
    OTP_MAX_ISSUES_PER_CHANNEL_WINDOW: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    OTP_MAX_ISSUES_PER_SUBJECT_WINDOW: z.coerce
      .number()
      .int()
      .positive()
      .default(5),
    OTP_MAX_ISSUES_PER_IP_WINDOW: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10),
    // ─── OTP WhatsApp (Meta API) ─────────────────────────────
    OTP_META_PHONE_NUMBER_ID: z.string().min(1).optional(),
    OTP_META_ACCESS_TOKEN: z.string().min(1).optional(),
    OTP_TEMPLATE_NAME: z.string().min(1).default('corvo_code_verify'),
    OTP_TEMPLATE_LANGUAGE: z.string().min(1).default('pt_BR'),
    OTP_META_GRAPH_VERSION: z.string().default('v20.0'),
    REFERRAL_ANNUAL_SALE_PERCENT: z.coerce.number().min(0).max(100).default(10),
    REFERRAL_MONTHLY_SALE_PERCENT: z.coerce.number().min(0).max(100).default(5),
    REFERRAL_MONTHLY_RECURRING_PERCENT: z.coerce
      .number()
      .min(0)
      .max(100)
      .default(3),
  })
  .superRefine((env, ctx) => {
    if (
      (env.NODE_ENV === 'production' || env.PUBLIC_CUSTOMER_SESSION_ENFORCED) &&
      !env.PUBLIC_CUSTOMER_SESSION_HMAC_SECRET
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_CUSTOMER_SESSION_HMAC_SECRET'],
        message:
          'PUBLIC_CUSTOMER_SESSION_HMAC_SECRET is required in production or when public sessions are enforced',
      });
    }
    if (env.SENTRY_ENABLED && !env.SENTRY_DSN) {
      ctx.addIssue({
        code: 'custom',
        path: ['SENTRY_DSN'],
        message: 'SENTRY_DSN is required when SENTRY_ENABLED=true',
      });
    }
    const allowedPaymentProviders = env.PAYMENT_ALLOWED_PROVIDERS.split(',')
      .map((provider) => provider.trim())
      .filter(Boolean);
    const invalidPaymentProvider = allowedPaymentProviders.find(
      (provider) => provider !== 'stripe',
    );
    if (invalidPaymentProvider) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_ALLOWED_PROVIDERS'],
        message: `Unsupported payment provider: ${invalidPaymentProvider}`,
      });
    }
    if (!allowedPaymentProviders.includes(env.PAYMENT_DEFAULT_PROVIDER)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_DEFAULT_PROVIDER'],
        message:
          'PAYMENT_DEFAULT_PROVIDER must be enabled in PAYMENT_ALLOWED_PROVIDERS',
      });
    }
    const stripeEnabled = allowedPaymentProviders.includes('stripe');
    if (env.NODE_ENV !== 'test' && stripeEnabled) {
      for (const key of [
        'STRIPE_SECRET_KEY',
        'STRIPE_PLATFORM_WEBHOOK_SECRET',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when Stripe is enabled`,
          });
        }
      }
    }
    if (env.STORAGE_PROVIDER === 's3') {
      for (const key of [
        'STORAGE_S3_ENDPOINT',
        'STORAGE_S3_ACCESS_KEY_ID',
        'STORAGE_S3_SECRET_ACCESS_KEY',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_PROVIDER=s3`,
          });
        }
      }
    }
    if (env.NODE_ENV === 'production' && env.STORAGE_PROVIDER !== 's3') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_PROVIDER'],
        message: 'STORAGE_PROVIDER=s3 is required in production',
      });
    }
    if (env.NODE_ENV !== 'test' && !env.SECRETS_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SECRETS_ENCRYPTION_KEY'],
        message: 'SECRETS_ENCRYPTION_KEY is required in non-test environments',
      });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of [
        'PUBLIC_API_URL',
        'OTP_HMAC_SECRET',
        'NFSE_MASTER_KEY',
        'RESEND_API_KEY',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function parseEnvConfig(config: Record<string, unknown>): EnvConfig {
  const configWithTestDefaults =
    config.NODE_ENV === 'test'
      ? {
          DATABASE_URL: 'postgresql://corvo:changeme@localhost:5432/corvo_test',
          REDIS_URL: 'redis://localhost:6379',
          AUTH_JWT_SECRET:
            'test-auth-jwt-secret-at-least-thirty-two-characters',
          AUTH_CSRF_SIGNING_SECRET:
            'test-auth-csrf-secret-at-least-thirty-two-characters',
          PUBLIC_CUSTOMER_SESSION_HMAC_SECRET:
            'test-public-session-hmac-secret-at-least-32-characters',
          WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-whatsapp-verify-token',
          WHATSAPP_TWO_STEP_PIN: '123456',
          META_APP_ID: 'test-meta-app-id',
          META_APP_SECRET: 'test-meta-app-secret',
          META_CONFIG_ID: 'test-meta-config-id',
          SECRETS_ENCRYPTION_KEY:
            'dGVzdC1zZWNyZXRzLWtleS0zMi1ieXRlcy0xMjM0NTY=',
          OTP_HMAC_SECRET: 'test-otp-hmac-secret-at-least-32-characters',
          ...config,
        }
      : config;

  const parsed = envSchema.parse(configWithTestDefaults);
  if (parsed.DB_POOL_MIN > parsed.DB_POOL_MAX) {
    throw new Error('DB_POOL_MIN must be less than or equal to DB_POOL_MAX');
  }
  return parsed;
}
