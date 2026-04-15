/**
 * Stored per-task metrics. These are persisted in VS Code workspaceState or globalState.
 * All fields are optional to support partial data from older versions.
 */
export interface ITaskMetrics {
  /** All-time execution count */
  totalExecutions: number;
  /** Executions with exitCode === 0 */
  successfulExecutions: number;
  /** Executions with exitCode !== 0 and not terminated */
  failedExecutions: number;
  /** Executions forcefully stopped or SIGINT-terminated (no exit code) */
  terminatedExecutions: number;
  /** Sum of all recorded durations in ms (excludes terminated runs with no duration) */
  totalDurationMs: number;
  /** Minimum recorded duration in ms */
  minDurationMs: number | undefined;
  /** Maximum recorded duration in ms */
  maxDurationMs: number | undefined;
  /**
   * Ring buffer of last N duration samples (non-terminated).
   * Used to compute median, p95, and trend.
   */
  recentDurations: number[];
  /** Epoch ms of the first execution */
  firstRunAt: number | undefined;
  /** Epoch ms of the most recent execution start */
  lastRunAt: number | undefined;
  /** Epoch ms of the most recent successful execution */
  lastSuccessAt: number | undefined;
  /** Epoch ms of the most recent failed execution */
  lastFailureAt: number | undefined;
  /** Epoch ms of the most recent terminated execution */
  lastTerminatedAt: number | undefined;
  /** Exit code from the most recent execution that had one */
  lastExitCode: number | undefined;
  /** Histogram of exit codes: key is exit code as string, value is count */
  exitCodeCounts: Record<string, number>;
  /** Number of consecutive failures (reset on success or terminated) */
  consecutiveFailures: number;
  /** Number of consecutive successes (reset on failure or terminated) */
  consecutiveSuccesses: number;
  /** Length-24 array: number of executions per hour of day (index = 0–23) */
  hourlyRunCounts: number[];
}

/**
 * Computed (derived) metrics — not stored, generated at read time by TaskMetricsAggregator.
 */
export interface ITaskMetricsComputed {
  avgDurationMs: number | undefined;
  medianDurationMs: number | undefined;
  p95DurationMs: number | undefined;
  /** Percentage 0–100 */
  successRate: number | undefined;
  /** True when consecutiveFailures >= 3 */
  isFlaky: boolean;
  mostCommonExitCode: string | undefined;
  /** 0–23 hour with most executions */
  peakHour: number | undefined;
  /** Average executions per day since firstRunAt */
  runFrequency: number | undefined;
  /**
   * Slope of the last (up to) 10 recentDurations via linear regression.
   * Positive = getting slower, negative = getting faster, undefined = not enough data.
   */
  durationTrend: number | undefined;
  /**
   * Exponential Moving Average of recentDurations (successful + failed, excludes terminated).
   * `undefined` when fewer than 3 samples are available.
   */
  typicalDurationMs: number | undefined;
  /**
   * Coefficient-of-variation bucket for recentDurations.
   * `undefined` when fewer than 3 samples are available.
   */
  durationVariability: 'Low' | 'Moderate' | 'High' | undefined;
}

/** Metrics enriched with computed fields */
export interface ITaskMetricsWithComputed extends ITaskMetrics, ITaskMetricsComputed {}

/** Creates a default (zeroed) ITaskMetrics object */
export function createDefaultMetrics(): ITaskMetrics {
  return {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    terminatedExecutions: 0,
    totalDurationMs: 0,
    minDurationMs: undefined,
    maxDurationMs: undefined,
    recentDurations: [],
    firstRunAt: undefined,
    lastRunAt: undefined,
    lastSuccessAt: undefined,
    lastFailureAt: undefined,
    lastTerminatedAt: undefined,
    lastExitCode: undefined,
    exitCodeCounts: {},
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    hourlyRunCounts: Array(24).fill(0),
  };
}
