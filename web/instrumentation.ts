import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
export const posthogConfigured = Boolean(posthogKey && posthogHost);

export const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes({ "service.name": "corvo-web" }),
  processors: posthogConfigured
    ? [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${posthogHost!.replace(/\/$/, "")}/i/v1/logs`,
            headers: {
              Authorization: `Bearer ${posthogKey!}`,
              "Content-Type": "application/json",
            },
          }),
        }),
      ]
    : [],
});

export const posthogLog = loggerProvider.getLogger("corvo-web.posthog");

export function register() {}
