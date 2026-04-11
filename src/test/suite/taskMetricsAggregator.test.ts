import * as assert from 'assert';
import { ITaskExecutionRecord } from '../../services/taskHistoryService';
import { ITaskMetrics, createDefaultMetrics } from '../../services/taskMetricsTypes';
import {
  appendToRingBuffer,
  updateMetricsFromRecord,
  computeStats,
  computeMetricsWithStats,
} from '../../services/taskMetricsAggregator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ITaskExecutionRecord> = {}): ITaskExecutionRecord {
  return {
    id: 'test-id',
    taskName: 'build',
    taskSource: 'npm',
    scope: 'workspace',
    definition: { type: 'npm' },
    startTime: Date.now(),
    endTime: Date.now() + 1000,
    duration: 1000,
    exitCode: 0,
    status: 'Success',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// appendToRingBuffer
// ---------------------------------------------------------------------------

suite('appendToRingBuffer', () => {
  test('appends a value to an empty buffer', () => {
    const result = appendToRingBuffer([], 42, 5);
    assert.deepStrictEqual(result, [42]);
  });

  test('appends without truncating when under limit', () => {
    const result = appendToRingBuffer([1, 2, 3], 4, 5);
    assert.deepStrictEqual(result, [1, 2, 3, 4]);
  });

  test('truncates oldest entries when over limit', () => {
    const result = appendToRingBuffer([1, 2, 3, 4, 5], 6, 5);
    assert.deepStrictEqual(result, [2, 3, 4, 5, 6]);
  });

  test('handles maxSize of 1', () => {
    const result = appendToRingBuffer([9], 7, 1);
    assert.deepStrictEqual(result, [7]);
  });

  test('does not mutate the original array', () => {
    const original = [1, 2, 3];
    appendToRingBuffer(original, 4, 3);
    assert.deepStrictEqual(original, [1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// updateMetricsFromRecord
// ---------------------------------------------------------------------------

suite('updateMetricsFromRecord', () => {
  test('creates default metrics for first record', () => {
    const rec = makeRecord({ status: 'Success', exitCode: 0, duration: 500 });
    const result = updateMetricsFromRecord(undefined, rec);
    assert.strictEqual(result.totalExecutions, 1);
    assert.strictEqual(result.successfulExecutions, 1);
    assert.strictEqual(result.failedExecutions, 0);
    assert.strictEqual(result.terminatedExecutions, 0);
    assert.strictEqual(result.totalDurationMs, 500);
    assert.strictEqual(result.minDurationMs, 500);
    assert.strictEqual(result.maxDurationMs, 500);
    assert.deepStrictEqual(result.recentDurations, [500]);
    assert.strictEqual(result.consecutiveSuccesses, 1);
    assert.strictEqual(result.consecutiveFailures, 0);
    assert.strictEqual(result.lastExitCode, 0);
    assert.strictEqual(result.exitCodeCounts['0'], 1);
  });

  test('ignores Running records', () => {
    const rec = makeRecord({ status: 'Running' });
    const result = updateMetricsFromRecord(undefined, rec);
    assert.strictEqual(result.totalExecutions, 0);
  });

  test('accumulates multiple successes', () => {
    let m: ITaskMetrics | undefined;
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', duration: 100, exitCode: 0 }));
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', duration: 200, exitCode: 0 }));
    assert.strictEqual(m.totalExecutions, 2);
    assert.strictEqual(m.successfulExecutions, 2);
    assert.strictEqual(m.totalDurationMs, 300);
    assert.strictEqual(m.minDurationMs, 100);
    assert.strictEqual(m.maxDurationMs, 200);
    assert.strictEqual(m.consecutiveSuccesses, 2);
    assert.strictEqual(m.consecutiveFailures, 0);
  });

  test('tracks failed execution correctly', () => {
    const rec = makeRecord({ status: 'Failed', exitCode: 1, duration: 200 });
    const result = updateMetricsFromRecord(undefined, rec);
    assert.strictEqual(result.failedExecutions, 1);
    assert.strictEqual(result.consecutiveFailures, 1);
    assert.strictEqual(result.consecutiveSuccesses, 0);
    assert.strictEqual(result.exitCodeCounts['1'], 1);
  });

  test('tracks terminated execution: no duration added', () => {
    const rec = makeRecord({ status: 'Terminated', exitCode: undefined, duration: 300 });
    const result = updateMetricsFromRecord(undefined, rec);
    assert.strictEqual(result.terminatedExecutions, 1);
    assert.strictEqual(result.totalDurationMs, 0);
    assert.deepStrictEqual(result.recentDurations, []);
  });

  test('resets consecutive streaks across different statuses', () => {
    let m: ITaskMetrics | undefined;
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    assert.strictEqual(m.consecutiveSuccesses, 2);
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Failed', exitCode: 1, duration: 50 }));
    assert.strictEqual(m.consecutiveSuccesses, 0);
    assert.strictEqual(m.consecutiveFailures, 1);
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    assert.strictEqual(m.consecutiveFailures, 0);
    assert.strictEqual(m.consecutiveSuccesses, 1);
  });

  test('ring buffer is capped at maxRecentSamples', () => {
    let m: ITaskMetrics | undefined;
    for (let i = 0; i < 5; i++) {
      m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', duration: i + 1, exitCode: 0 }), 3);
    }
    assert.strictEqual(m!.recentDurations.length, 3);
    assert.deepStrictEqual(m!.recentDurations, [3, 4, 5]);
  });

  test('hourlyRunCounts increments for the correct hour', () => {
    const now = new Date();
    const hour = now.getHours();
    const rec = makeRecord({ status: 'Success', exitCode: 0, duration: 100, startTime: now.getTime() });
    const result = updateMetricsFromRecord(undefined, rec);
    assert.strictEqual(result.hourlyRunCounts[hour], 1);
  });

  test('firstRunAt and lastRunAt set correctly', () => {
    const t1 = 1000;
    const t2 = 2000;
    let m: ITaskMetrics | undefined;
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', startTime: t1, exitCode: 0, duration: 50 }));
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', startTime: t2, exitCode: 0, duration: 50 }));
    assert.strictEqual(m.firstRunAt, t1);
    assert.strictEqual(m.lastRunAt, t2);
  });

  test('does not mutate the existing metrics object', () => {
    const original = createDefaultMetrics();
    const rec = makeRecord({ status: 'Success', duration: 100, exitCode: 0 });
    updateMetricsFromRecord(original, rec);
    assert.strictEqual(original.totalExecutions, 0);
  });

  test('exit code histogram accumulates counts', () => {
    let m: ITaskMetrics | undefined;
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Failed', exitCode: 1, duration: 50 }));
    assert.strictEqual(m.exitCodeCounts['0'], 2);
    assert.strictEqual(m.exitCodeCounts['1'], 1);
  });
});

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

suite('computeStats', () => {
  test('returns undefined for empty metrics', () => {
    const stats = computeStats(createDefaultMetrics());
    assert.strictEqual(stats.avgDurationMs, undefined);
    assert.strictEqual(stats.medianDurationMs, undefined);
    assert.strictEqual(stats.p95DurationMs, undefined);
    assert.strictEqual(stats.successRate, undefined);
    assert.strictEqual(stats.mostCommonExitCode, undefined);
    assert.strictEqual(stats.peakHour, undefined);
    assert.strictEqual(stats.runFrequency, undefined);
    assert.strictEqual(stats.durationTrend, undefined);
    assert.strictEqual(stats.isFlaky, false);
  });

  test('computes successRate correctly', () => {
    let m: ITaskMetrics | undefined;
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Failed', exitCode: 1, duration: 50 }));
    const stats = computeStats(m);
    assert.ok(stats.successRate !== undefined);
    assert.ok(Math.abs(stats.successRate! - (2 / 3) * 100) < 0.001);
  });

  test('successRate is 100 when all succeeded', () => {
    let m: ITaskMetrics | undefined;
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 100 }));
    assert.strictEqual(computeStats(m).successRate, 100);
  });

  test('successRate is 0 when all failed', () => {
    let m: ITaskMetrics | undefined;
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Failed', exitCode: 1, duration: 50 }));
    assert.strictEqual(computeStats(m).successRate, 0);
  });

  test('computes median for odd-length buffer', () => {
    const m = { ...createDefaultMetrics(), recentDurations: [1, 3, 5] };
    assert.strictEqual(computeStats(m).medianDurationMs, 3);
  });

  test('computes median for even-length buffer', () => {
    const m = { ...createDefaultMetrics(), recentDurations: [1, 2, 3, 4] };
    assert.strictEqual(computeStats(m).medianDurationMs, 2.5);
  });

  test('computes p95 correctly', () => {
    // 20 values 1..20, p95 = value at index ceil(20*0.95)-1 = 18 (19th value = 19)
    const durations = Array.from({ length: 20 }, (_, i) => i + 1);
    const m = { ...createDefaultMetrics(), recentDurations: durations };
    const stats = computeStats(m);
    assert.ok(stats.p95DurationMs !== undefined);
    assert.strictEqual(stats.p95DurationMs, 19);
  });

  test('isFlaky when consecutiveFailures >= 3', () => {
    const m = { ...createDefaultMetrics(), consecutiveFailures: 3 };
    assert.strictEqual(computeStats(m).isFlaky, true);
  });

  test('isFlaky false when consecutiveFailures < 3', () => {
    const m = { ...createDefaultMetrics(), consecutiveFailures: 2 };
    assert.strictEqual(computeStats(m).isFlaky, false);
  });

  test('mostCommonExitCode returns the most frequent', () => {
    const m = { ...createDefaultMetrics(), exitCodeCounts: { '0': 5, '1': 2 } };
    assert.strictEqual(computeStats(m).mostCommonExitCode, '0');
  });

  test('peakHour returns hour with most executions', () => {
    const hourly = Array(24).fill(0);
    hourly[14] = 10;
    hourly[9] = 5;
    const m = { ...createDefaultMetrics(), hourlyRunCounts: hourly };
    assert.strictEqual(computeStats(m).peakHour, 14);
  });

  test('peakHour is undefined when no executions', () => {
    assert.strictEqual(computeStats(createDefaultMetrics()).peakHour, undefined);
  });

  test('durationTrend positive when durations increasing', () => {
    const m = { ...createDefaultMetrics(), recentDurations: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] };
    const trend = computeStats(m).durationTrend;
    assert.ok(trend !== undefined && trend > 0, `expected positive trend, got ${trend}`);
  });

  test('durationTrend negative when durations decreasing', () => {
    const m = { ...createDefaultMetrics(), recentDurations: [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100] };
    const trend = computeStats(m).durationTrend;
    assert.ok(trend !== undefined && trend < 0, `expected negative trend, got ${trend}`);
  });

  test('durationTrend undefined with single sample', () => {
    const m = { ...createDefaultMetrics(), recentDurations: [500] };
    assert.strictEqual(computeStats(m).durationTrend, undefined);
  });

  test('runFrequency computed from firstRunAt', () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const m = { ...createDefaultMetrics(), totalExecutions: 10, firstRunAt: twoDaysAgo };
    const freq = computeStats(m).runFrequency;
    assert.ok(freq !== undefined);
    // Should be approx 5 runs/day for 10 runs over ~2 days
    assert.ok(freq! > 4 && freq! < 6, `expected ~5, got ${freq}`);
  });
});

// ---------------------------------------------------------------------------
// computeMetricsWithStats
// ---------------------------------------------------------------------------

suite('computeMetricsWithStats', () => {
  test('returns merged stored and computed fields', () => {
    let m: ITaskMetrics | undefined;
    m = updateMetricsFromRecord(m, makeRecord({ status: 'Success', exitCode: 0, duration: 500 }));
    const result = computeMetricsWithStats(m);
    assert.strictEqual(result.totalExecutions, 1);
    assert.strictEqual(result.successRate, 100);
    assert.strictEqual(result.isFlaky, false);
  });
});
