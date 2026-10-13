import { NodeSDK } from '@opentelemetry/sdk-node';
import { createOpenTelemetrySdk } from './tracing-sdk.factory';

let sdk: NodeSDK | null = null;

export function startOpenTelemetry(): NodeSDK | null {
  if (process.env.OTEL_ENABLED !== 'true') {
    return null;
  }

  sdk = createOpenTelemetrySdk({
    serviceName:
      process.env.OTEL_SERVICE_NAME ??
      process.env.APP_NAME ??
      'greenflow-backend',
    serviceVersion: process.env.APP_VERSION ?? '0.0.1',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    sampleRatio: parseSampleRatio(process.env.OTEL_SAMPLE_RATIO),
  });

  sdk.start();
  registerShutdown();

  return sdk;
}

function parseSampleRatio(value: string | undefined): number {
  if (value === undefined) return 1;
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}

function registerShutdown(): void {
  const shutdown = async () => {
    if (sdk === null) return;
    await sdk.shutdown();
    sdk = null;
  };

  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}

startOpenTelemetry();
