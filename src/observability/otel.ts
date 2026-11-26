import { SpanStatusCode, diag, DiagLogLevel } from '@opentelemetry/api';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

diag.setLogger(
  {
    verbose() {},
    debug() {},
    info() {},
    warn(message) {
      console.error(message);
    },
    error(message) {
      console.error(message);
    },
  },
  DiagLogLevel.WARN,
);

process.env.OTEL_METRICS_EXPORTER ??= 'none';
process.env.OTEL_LOGS_EXPORTER ??= 'none';

class NoopSpanExporter implements SpanExporter {
  export(_spans: ReadableSpan[], callback: (result: ExportResult) => void): void {
    callback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

function tracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const exporter: SpanExporter = endpoint
  ? new OTLPTraceExporter({ url: tracesUrl(endpoint) })
  : new NoopSpanExporter();

const spanProcessor = new BatchSpanProcessor({
  exporter,
  scheduledDelayMillis: 200,
});

const disabled = { enabled: false } as const;

const sdk = new NodeSDK({
  autoDetectResources: false,
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || 'marketplace-api',
  }),
  spanProcessors: [spanProcessor],
  metricReaders: [],
  logRecordProcessors: [],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': disabled,
      '@opentelemetry/instrumentation-dns': disabled,
      '@opentelemetry/instrumentation-net': disabled,
      '@opentelemetry/instrumentation-pino': disabled,
      '@opentelemetry/instrumentation-express': disabled,
      '@opentelemetry/instrumentation-nestjs-core': disabled,
      '@opentelemetry/instrumentation-host-metrics': disabled,
      '@opentelemetry/instrumentation-runtime-node': disabled,
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook(request) {
          const url = request.url ?? '';
          return (
            url.startsWith('/health') ||
            url.startsWith('/metrics') ||
            url.startsWith('/debug/')
          );
        },
        responseHook(span, response) {
          const statusCode = response.statusCode;
          if (typeof statusCode === 'number' && statusCode >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
        },
      },
    }),
  ],
});

sdk.start();

export async function flushTraces(): Promise<void> {
  await spanProcessor.forceFlush();
}
