import { z } from 'zod';
import { booleanFromEnv } from './boolean-env.schema';

/** `*` or a comma separated list of tenant UUIDs. Empty means not set (every tenant). */
function optionalNonEmptyString() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  );
}

function effectivePaymentProviders(env: {
  DEPLOYMENT_MODE: 'cloud' | 'self_hosted';
  PAYMENT_ALLOWED_PROVIDERS?: string;
}): string {
  return (
    env.PAYMENT_ALLOWED_PROVIDERS ??
    (env.DEPLOYMENT_MODE === 'self_hosted' ? '' : 'stripe')
  );
}

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
    /** `restricted` sends live invoices to the Sefin Produção Restrita (homologation), never to production. */
    NFSE_SEFIN_ENVIRONMENT: z
      .enum(['production', 'restricted'])
      .default('production'),
    /**
     * Where `test` invoices go: `sefin` (default) emits them in the Sefin Produção Restrita with the
     * company's certificate, no legal validity; `fake` is the in-process simulator, for automated tests.
     */
    NFSE_TEST_PROVIDER: z.enum(['sefin', 'fake']).default('sefin'),
    /**
     * The one NF-e / NFC-e switch: blocks tpAmb=1 (production); only homologation is allowed while
     * false. NF-e and NFC-e in test are open to every workspace and need no flag.
     */
    NFE_PRODUCTION_ENABLED: booleanFromEnv.default(false),
    /** Where `test` NF-e go: `sefaz` (homologation) or `fake` (in-process simulator, automated tests). */
    NFE_TEST_PROVIDER: z.enum(['sefaz', 'fake']).default('sefaz'),
    NFE_SEFAZ_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    /** Responsible technician written in `infRespTec` (Corvo as the software house). All four or none. */
    NFE_RESP_TEC_CNPJ: z.string().trim().optional(),
    NFE_RESP_TEC_CONTACT: z.string().trim().optional(),
    NFE_RESP_TEC_EMAIL: z.string().trim().optional(),
    NFE_RESP_TEC_PHONE: z.string().trim().optional(),
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
    // Verify the PostgreSQL certificate (default). Provide DB_SSL_CA for a private or provider CA.
    DB_SSL_REJECT_UNAUTHORIZED: booleanFromEnv.default(true),
    DB_SSL_CA: z.string().min(1).optional(),
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
    RATE_LIMIT_TENANT: z.coerce.number().int().positive().default(600),
    MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(0).default(200),
    HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    RATE_LIMIT_PRE_AUTH: z.coerce.number().int().positive().default(1200),
    RATE_LIMIT_STRIPE_WEBHOOK: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_INTEGRATION_INBOUND: z.coerce
      .number()
      .int()
      .positive()
      .default(600),
    REDIS_URL: z.string().min(1),
    REDIS_KEY_PREFIX: z.string().min(1).default('corvo'),
    REDIS_CACHE_DEFAULT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    QUEUE_DEFAULT_ATTEMPTS: z.coerce.number().int().positive().default(3),
    QUEUE_DEFAULT_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    // Invoices sent to the fiscal portal at once by each worker. The DPS number is reserved
    // atomically and each invoice has its own lock, so parallel emissions never share a number.
    NFSE_EMISSION_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3),
    // Test (homologação) jobs run in their own `*-test` queues so they never delay production.
    // This is how many jobs each test queue runs at once per worker (one number for all twins).
    TEST_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    // Portal outage: after this many unanswered calls in a row emission pauses for the cooldown,
    // and an invoice left without a conclusive answer for the max hours goes to manual review.
    NFSE_PORTAL_BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(5),
    NFSE_PORTAL_BREAKER_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .default(300_000),
    // Brake on calls to each government host (shared by all replicas): requests per second,
    // the burst allowed after a quiet moment, and how long a caller waits for its turn.
    GOV_RATE_LIMIT_PER_SECOND: z.coerce.number().min(0.1).max(100).default(5),
    GOV_RATE_LIMIT_BURST: z.coerce.number().int().min(1).max(500).default(10),
    GOV_RATE_LIMIT_MAX_WAIT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(10_000),
    // Most items the recovery job puts back in the queue per run (every 5 minutes).
    DOCS_RECOVERY_MAX_PER_RUN: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50),
    NFSE_UNCERTAIN_MAX_HOURS: z.coerce.number().int().min(1).max(72).default(6),
    // Reads what happened to issued invoices on the national portal (cancellations, taker rejections).
    // Off by default: turn it on in live only after a round against the Produção Restrita was checked.
    PORTAL_SYNC_ENABLED: booleanFromEnv.default(false),
    // Query-only sweep (every 30 min) that asks the portal about invoices parked in manual review.
    // It never sends anything: it only authorizes an invoice whose DPS the portal already has.
    MANUAL_REVIEW_SWEEP_ENABLED: booleanFromEnv.default(true),
    MANUAL_REVIEW_SWEEP_BATCH: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50),
    MANUAL_REVIEW_SWEEP_MAX_AGE_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30),
    // Every minute the worker checks it can open a connection to the government NFS-e hosts and
    // e-mails the operator (OPS_ALERT_EMAILS, comma-separated) when it cannot. Empty = nobody is e-mailed.
    PORTAL_PROBE_ENABLED: booleanFromEnv.default(true),
    // A host outside the government used to tell "our network is down" from "the portal is down".
    PORTAL_PROBE_CONTROL_HOST: z.string().trim().min(1).default('1.1.1.1'),
    OPS_ALERT_EMAILS: z.string().optional(),
    /**
     * Optional backup route to the government: an HTTP CONNECT proxy (`http://user:pass@host:port`) that
     * runs OUTSIDE our host. Used only while the connection monitor says our network cannot reach the
     * government (`gov_unreachable_from_us`); otherwise calls go direct. Contains credentials: never log it.
     */
    FISCAL_HTTPS_PROXY: z
      .string()
      .trim()
      .url()
      .refine(
        (value) => value.startsWith('http://') || value.startsWith('https://'),
        'must be an http(s) URL',
      )
      .optional(),
    // Calls to the portal that failed to connect in 10 minutes before the alert opens even when the
    // tests pass. 0 turns this signal off.
    OPS_ALERT_EMISSION_FAILURES: z.coerce.number().int().min(0).default(10),
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    // How often the worker looks for webhook deliveries that are due (retries and anything the immediate send missed).
    WEBHOOK_RETRY_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    OUTBOX_LEASE_MS: z.coerce.number().int().positive().default(120000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    OUTBOX_SCHEDULE_MAX_DAYS: z.coerce.number().int().positive().default(15),
    FISCAL_IBSCBS_UNAVAILABLE_MODE: z.enum(['block', 'warn']).default('block'),
    // An empty value (RTC_CALCULATOR_URL=) means "not configured".
    RTC_CALCULATOR_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
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
    RTC_EXPECTED_VERSION: z.string().trim().min(1).optional(),
    FISCAL_NT009_CUTOVER_AT: z
      .string()
      .datetime({ offset: true })
      .default('2026-12-01T00:00:00-03:00'),
    FISCAL_DPS_LAYOUT: z
      .enum(['rtc-v1.01', 'nt009-r1', 'auto'])
      .default('rtc-v1.01'),
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
    /** Lifecycle e-mails to the workspace owners. The master switch turns all off; each kind has its own. */
    LIFECYCLE_EMAILS_ENABLED: booleanFromEnv.default(true),
    LIFECYCLE_EMAIL_FIRST_INVOICE: booleanFromEnv.default(true),
    LIFECYCLE_EMAIL_MONTHLY_SUMMARY: booleanFromEnv.default(true),
    LIFECYCLE_EMAIL_CREDITS_FORECAST: booleanFromEnv.default(true),
    LIFECYCLE_EMAIL_PENDING_PAYMENT: booleanFromEnv.default(true),
    LIFECYCLE_EMAIL_REJECTION_HELP: booleanFromEnv.default(true),
    SENTRY_FLUSH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(60_000)
      .default(2000),
    SENTRY_CAPTURE_DISCONNECTS: booleanFromEnv.default(true),
    /** `cloud` bills with Stripe; `self_hosted` has no billing, quotas or credits. */
    DEPLOYMENT_MODE: z.enum(['cloud', 'self_hosted']).default('cloud'),
    /** Comma-separated, lowercase e-mails that are platform admins (verified e-mail required). Empty = nobody. */
    PLATFORM_ADMIN_EMAILS: z.string().optional(),
    /** Who may create an account. Defaults to `open` in cloud and `closed` in self_hosted. */
    AUTH_SIGNUP_MODE: z.enum(['open', 'allowlist', 'closed']).optional(),
    /** Public by nature: served by GET /v1/config so the web needs no rebuild. */
    TURNSTILE_SITE_KEY: optionalNonEmptyString(),
    /** Defaults to `stripe` in cloud and to none in self_hosted. */
    PAYMENT_ALLOWED_PROVIDERS: z.string().optional(),
    PAYMENT_DEFAULT_PROVIDER: z.enum(['stripe', 'woovi']).default('stripe'),
    WOOVI_APP_ID: z.string().min(1).optional(),
    WOOVI_WEBHOOK_TOKEN: z.string().min(16).optional(),
    WOOVI_API_URL: z.string().url().default('https://api.woovi.com/api/v1'),
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
    /** Key behind AbacatePay's X-Webhook-Signature; the URL secret authenticates alone while unset. */
    ABACATEPAY_WEBHOOK_PUBLIC_KEY: z.string().min(1).optional(),
    // ─── OAuth Providers ──────────────────────────────────────────
    // An empty credential (GOOGLE_CLIENT_ID=) means "provider not configured".
    GOOGLE_CLIENT_ID: optionalNonEmptyString(),
    GOOGLE_CLIENT_SECRET: optionalNonEmptyString(),
    GOOGLE_REDIRECT_URL: z.string().url().optional(),
    GITHUB_CLIENT_ID: optionalNonEmptyString(),
    GITHUB_CLIENT_SECRET: optionalNonEmptyString(),
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
    /** Shared with the web proxy so the API can trust the browser IP it forwards. */
    PROXY_SHARED_SECRET: z.string().min(32).optional(),
    /** Set to true only when the API is reachable through Cloudflare alone. */
    TRUST_CF_CONNECTING_IP: z.enum(['true', 'false']).optional(),
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
    // NT 009 release 1 is only accepted by the Sefin Produção Restrita until it
    // reaches production; the current layout stays the production default.
    if (
      env.FISCAL_DPS_LAYOUT === 'nt009-r1' &&
      env.NFSE_SEFIN_ENVIRONMENT !== 'restricted'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['FISCAL_DPS_LAYOUT'],
        message:
          'FISCAL_DPS_LAYOUT=nt009-r1 requires NFSE_SEFIN_ENVIRONMENT=restricted (Produção Restrita only)',
      });
    }
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
    const allowedPaymentProviders = effectivePaymentProviders(env)
      .split(',')
      .map((provider) => provider.trim())
      .filter(Boolean);
    const invalidPaymentProvider = allowedPaymentProviders.find(
      (provider) => provider !== 'stripe' && provider !== 'woovi',
    );
    if (invalidPaymentProvider) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_ALLOWED_PROVIDERS'],
        message: `Unsupported payment provider: ${invalidPaymentProvider}`,
      });
    }
    if (
      allowedPaymentProviders.length > 0 &&
      !allowedPaymentProviders.includes(env.PAYMENT_DEFAULT_PROVIDER)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_DEFAULT_PROVIDER'],
        message:
          'PAYMENT_DEFAULT_PROVIDER must be enabled in PAYMENT_ALLOWED_PROVIDERS',
      });
    }
    const wooviEnabled = allowedPaymentProviders.includes('woovi');
    if (env.NODE_ENV !== 'test' && wooviEnabled) {
      for (const key of ['WOOVI_APP_ID', 'WOOVI_WEBHOOK_TOKEN'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when Woovi is enabled`,
          });
        }
      }
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
  })
  .transform((env) => ({
    ...env,
    PAYMENT_ALLOWED_PROVIDERS: effectivePaymentProviders(env),
    AUTH_SIGNUP_MODE:
      env.AUTH_SIGNUP_MODE ??
      (env.DEPLOYMENT_MODE === 'self_hosted'
        ? ('closed' as const)
        : ('open' as const)),
  }));

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
