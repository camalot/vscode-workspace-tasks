import { ITaskExecutionRecord } from './taskHistoryService';
import {
  ITaskMetrics,
  ITaskMetricsComputed,
  ITaskMetricsWithComputed,
  createDefaultMetrics,
} from './taskMetricsTypes';

// ---------------------------------------------------------------------------
// Ring-buffer helper
// ---------------------------------------------------------------------------

/**
 * Appends a value to a ring buffer, capping its length at maxSize.
 * Returns a new array (non-mutating).
 */
export function appendToRingBuffer(buffer: number[], value: number, maxSize: number): number[] {
  const next = [...buffer, value];
  if (next.length > maxSize) {
    return next.slice(next.length - maxSize);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Stat helpers
// ---------------------------------------------------------------------------

/** Returns the median of a sorted numeric array, or undefined if empty. */
function median(sorted: number[]): number | undefined {
  if (sorted.length === 0) { return undefined; }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Returns the p95 of a sorted numeric array, or undefined if empty. */
function p95(sorted: number[]): number | undefined {
  if (sorted.length === 0) { return undefined; }
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Computes slope via linear regression on an array of y-values (x is implicit index).
 * Returns undefined when fewer than 2 values.
 */
function slope(values: number[]): number | undefined {
  if (values.length < 2) { return undefined; }
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) { return 0; }
  return (n * sumXY - sumX * sumY) / denom;
}

// ---------------------------------------------------------------------------
// Core aggregation
// ---------------------------------------------------------------------------

/**
 * Updates existing metrics with a freshly completed task execution record.
 * Returns a new ITaskMetrics (non-mutating). Pass `maxRecentSamples` to
 * control the ring-buffer cap (default 100).
 */
export function updateMetricsFromRecord(
  existing: ITaskMetrics | undefined,
  record: ITaskExecutionRecord,
  maxRecentSamples = 100,
): ITaskMetrics {
  const m: ITaskMetrics = existing
    ? { ...existing, exitCodeCounts: { ...existing.exitCodeCounts }, recentDurations: [...existing.recentDurations], hourlyRunCounts: [...existing.hourlyRunCounts] }
    : createDefaultMetrics();

  // Skip in-progress records
  if (record.status === 'Running') {
    return m;
  }

  m.totalExecutions += 1;

  // Hour-of-day histogram
  const hour = new Date(record.startTime).getHours();
  m.hourlyRunCounts[hour] = (m.hourlyRunCounts[hour] ?? 0) + 1;

  // Timestamps
  if (m.firstRunAt === undefined || record.startTime < m.firstRunAt) {
    m.firstRunAt = record.startTime;
  }
  m.lastRunAt = record.startTime;

  // Exit code tracking
  if (record.exitCode !== undefined) {
    m.lastExitCode = record.exitCode;
    const key = String(record.exitCode);
    m.exitCodeCounts[key] = (m.exitCodeCounts[key] ?? 0) + 1;
  }

  // Status-specific counters
  if (record.status === 'Success') {
    m.successfulExecutions += 1;
    m.consecutiveSuccesses += 1;
    m.consecutiveFailures = 0;
    m.lastSuccessAt = record.startTime;
  } else if (record.status === 'Failed') {
    m.failedExecutions += 1;
    m.consecutiveFailures += 1;
    m.consecutiveSuccesses = 0;
    m.lastFailureAt = record.startTime;
  } else if (record.status === 'Terminated') {
    m.terminatedExecutions += 1;
    m.consecutiveFailures = 0;
    m.consecutiveSuccesses = 0;
    m.lastTerminatedAt = record.startTime;
  }

  // Duration tracking (only for runs that have a duration)
  if (record.duration !== undefined && record.status !== 'Terminated') {
    const d = record.duration;
    m.totalDurationMs += d;
    m.minDurationMs = m.minDurationMs === undefined ? d : Math.min(m.minDurationMs, d);
    m.maxDurationMs = m.maxDurationMs === undefined ? d : Math.max(m.maxDurationMs, d);
    m.recentDurations = appendToRingBuffer(m.recentDurations, d, maxRecentSamples);
  }

  return m;
}

// ---------------------------------------------------------------------------
// Computed stats
// ---------------------------------------------------------------------------

/**
 * Derives ITaskMetricsComputed from stored ITaskMetrics. Pure function — no I/O.
 */
export function computeStats(metrics: ITaskMetrics): ITaskMetricsComputed {
  const completed = metrics.successfulExecutions + metrics.failedExecutions;

  // Duration stats from ring buffer (sorted copy)
  const sorted = [...metrics.recentDurations].sort((a, b) => a - b);
  const recentDurationTotalMs = metrics.recentDurations.reduce((sum, duration) => sum + duration, 0);
  const avgDurationMs =
    metrics.recentDurations.length > 0
      ? recentDurationTotalMs / metrics.recentDurations.length
      : undefined;
  // Success rate: only over non-terminated runs
  const successRate =
    completed === 0
      ? undefined
      : (metrics.successfulExecutions / completed) * 100;

  // Most common exit code
  let mostCommonExitCode: string | undefined;
  let maxCount = 0;
  for (const [code, count] of Object.entries(metrics.exitCodeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonExitCode = code;
    }
  }

  // Peak hour
  let peakHour: number | undefined;
  let peakCount = 0;
  for (let h = 0; h < 24; h++) {
    const count = metrics.hourlyRunCounts[h] ?? 0;
    if (count > peakCount) {
      peakCount = count;
      peakHour = h;
    }
  }
  if (peakCount === 0) { peakHour = undefined; }

  // Run frequency (avg runs per day since firstRunAt)
  let runFrequency: number | undefined;
  if (metrics.firstRunAt !== undefined && metrics.totalExecutions > 0) {
    const nowMs = Date.now();
    const daysSinceFirst = (nowMs - metrics.firstRunAt) / (1000 * 60 * 60 * 24);
    runFrequency = daysSinceFirst >= 1 ? metrics.totalExecutions / daysSinceFirst : metrics.totalExecutions;
  }

  // Duration trend: slope of last 10 recentDurations
  const trendSamples = metrics.recentDurations.slice(-10);
  const durationTrend = slope(trendSamples);

  return {
    avgDurationMs,
    medianDurationMs: median(sorted),
    p95DurationMs: p95(sorted),
    successRate,
    isFlaky: metrics.consecutiveFailures >= 3,
    mostCommonExitCode,
    peakHour,
    runFrequency,
    durationTrend,
  };
}

/**
 * Returns metrics combined with computed fields.
 */
export function computeMetricsWithStats(metrics: ITaskMetrics): ITaskMetricsWithComputed {
  return { ...metrics, ...computeStats(metrics) };
}
