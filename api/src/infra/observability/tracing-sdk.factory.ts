import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

type OpenTelemetrySdkOptions = {
  serviceName: string;
  serviceVersion: string;
  endpoint?: string;
  sampleRatio: number;
};

export function createOpenTelemetrySdk(
  options: OpenTelemetrySdkOptions,
): NodeSDK {
  return new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(options.sampleRatio),
    }),
    traceExporter: new OTLPTraceExporter({
      url: buildOtlpHttpUrl(options.endpoint, 'v1/traces'),
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: buildOtlpHttpUrl(options.endpoint, 'v1/metrics'),
        }),
      }),
    ],
    instrumentations: [getNodeAutoInstrumentations()],
  });
}

function buildOtlpHttpUrl(
  endpoint: string | undefined,
  signalPath: 'v1/traces' | 'v1/metrics',
): string | undefined {
  if (endpoint === undefined) return undefined;
  return `${endpoint.replace(/\/+$/g, '')}/${signalPath}`;
}
