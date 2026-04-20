import { ITaskExecutionRecord } from './taskHistoryService';

/**
 * A JSON-safe representation of {@link ITaskExecutionRecord} suitable for
 * writing to NDJSON storage or VS Code workspaceState.
 *
 * Only the known-safe, serializable fields from `definition` are preserved.
 */
export interface ISerializedTaskExecutionRecord {
  id: string;
  taskName: string;
  taskSource: string;
  scope: string;
  definitionType: string;
  definitionPath?: string;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  status: 'Running' | 'Success' | 'Terminated' | 'Failed';
  duration?: number;
}

/**
 * Converts a live {@link ITaskExecutionRecord} to a JSON-safe
 * {@link ISerializedTaskExecutionRecord}, stripping any non-serializable or
 * potentially sensitive fields from `definition`.
 */
export function serialize(record: ITaskExecutionRecord): ISerializedTaskExecutionRecord {
  const serialized: ISerializedTaskExecutionRecord = {
    id: record.id,
    taskName: record.taskName,
    taskSource: record.taskSource,
    scope: record.scope,
    definitionType: record.definition.type,
    startTime: record.startTime,
    status: record.status,
  };

  if (record.definition.path !== undefined) {
    serialized.definitionPath = record.definition.path;
  }
  if (record.endTime !== undefined) {
    serialized.endTime = record.endTime;
  }
  if (record.exitCode !== undefined) {
    serialized.exitCode = record.exitCode;
  }
  if (record.duration !== undefined) {
    serialized.duration = record.duration;
  }

  return serialized;
}

/**
 * Reconstructs an {@link ITaskExecutionRecord} from a persisted
 * {@link ISerializedTaskExecutionRecord}. The `definition` is rebuilt
 * with only the fields that were serialized.
 */
export function deserialize(raw: ISerializedTaskExecutionRecord): ITaskExecutionRecord {
  const definition: { type: string; path?: string } = { type: raw.definitionType };
  if (raw.definitionPath !== undefined) {
    definition.path = raw.definitionPath;
  }

  return {
    id: raw.id,
    taskName: raw.taskName,
    taskSource: raw.taskSource,
    scope: raw.scope,
    definition,
    startTime: raw.startTime,
    endTime: raw.endTime,
    exitCode: raw.exitCode,
    status: raw.status,
    duration: raw.duration,
  };
}

/**
 * Parses a single NDJSON line. Returns `null` for empty lines or malformed
 * JSON — callers should skip `null` results rather than throwing.
 */
export function parseNdjsonLine(line: string): ISerializedTaskExecutionRecord | null {
  const trimmed = line.trim();
  if (!trimmed) { return null; }
  try {
    return JSON.parse(trimmed) as ISerializedTaskExecutionRecord;
  } catch {
    return null;
  }
}
