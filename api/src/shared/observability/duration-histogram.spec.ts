import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  AGENT_RUNTIME_DURATION_BOUNDARIES_SECONDS,
  TYPEORM_OPERATION_DURATION_BOUNDARIES_SECONDS,
  TYPEORM_TRANSACTION_DURATION_BOUNDARIES_SECONDS,
  durationHistogramOptions,
} from './duration-histogram';

describe('duration histogram configuration', () => {
  it.each([
    [
      'TypeORM operations',
      TYPEORM_OPERATION_DURATION_BOUNDARIES_SECONDS,
      0.005,
      10,
    ],
    [
      'TypeORM transactions',
      TYPEORM_TRANSACTION_DURATION_BOUNDARIES_SECONDS,
      0.005,
      120,
    ],
    ['agent runtime', AGENT_RUNTIME_DURATION_BOUNDARIES_SECONDS, 0.01, 300],
  ])(
    'defines an ordered, unique seconds profile for %s',
    (_name, boundaries, first, last) => {
      expect(boundaries[0]).toBe(first);
      expect(boundaries.at(-1)).toBe(last);
      expect(boundaries.every((boundary) => boundary > 0)).toBe(true);
      expect(new Set(boundaries).size).toBe(boundaries.length);
      expect(boundaries).toEqual([...boundaries].sort((a, b) => a - b));
    },
  );

  it('exports seconds using the advised buckets instead of SDK defaults', async () => {
    const exporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    const histogram = provider
      .getMeter('greenflow.test')
      .createHistogram(
        'greenflow.test.duration',
        durationHistogramOptions(
          'Test duration',
          TYPEORM_OPERATION_DURATION_BOUNDARIES_SECONDS,
        ),
      );

    histogram.record(0.008);
    histogram.record(11);
    await provider.forceFlush();

    const metric = exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .find(
        (candidate) => candidate.descriptor.name === 'greenflow.test.duration',
      );

    expect(metric?.descriptor.unit).toBe('s');
    if (!metric || metric.dataPointType !== DataPointType.HISTOGRAM) {
      throw new Error('Expected an explicit-bucket histogram metric');
    }

    const value = metric.dataPoints[0]?.value;
    expect(value?.buckets.boundaries).toEqual(
      TYPEORM_OPERATION_DURATION_BOUNDARIES_SECONDS,
    );
    expect(value?.buckets.counts[1]).toBe(1);
    expect(value?.buckets.counts.at(-1)).toBe(1);

    await provider.shutdown();
  });
});
