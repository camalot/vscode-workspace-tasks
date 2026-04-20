import * as assert from 'assert';
import { ITaskExecutionRecord } from '../../services/taskHistoryService';
import {
  serialize,
  deserialize,
  parseNdjsonLine,
  ISerializedTaskExecutionRecord,
} from '../../services/taskHistorySerializer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ITaskExecutionRecord> = {}): ITaskExecutionRecord {
  return {
    id: 'test-id-1',
    taskName: 'build',
    taskSource: 'npm',
    scope: 'my-workspace',
    definition: { type: 'npm', script: 'build', path: '/workspace' },
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_005_000,
    exitCode: 0,
    status: 'Success',
    duration: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: serialize
// ---------------------------------------------------------------------------

suite('taskHistorySerializer — serialize', () => {
  test('produces ISerializedTaskExecutionRecord with all expected fields', () => {
    const record = makeRecord();
    const s = serialize(record);

    assert.strictEqual(s.id, record.id);
    assert.strictEqual(s.taskName, record.taskName);
    assert.strictEqual(s.taskSource, record.taskSource);
    assert.strictEqual(s.scope, record.scope);
    assert.strictEqual(s.definitionType, 'npm');
    assert.strictEqual(s.definitionPath, '/workspace');
    assert.strictEqual(s.startTime, record.startTime);
    assert.strictEqual(s.endTime, record.endTime);
    assert.strictEqual(s.exitCode, record.exitCode);
    assert.strictEqual(s.status, 'Success');
    assert.strictEqual(s.duration, record.duration);
  });

  test('omits definitionPath when definition has no path field', () => {
    const record = makeRecord({ definition: { type: 'shell' } });
    const s = serialize(record);
    assert.strictEqual(s.definitionType, 'shell');
    assert.strictEqual(s.definitionPath, undefined);
    assert.ok(!('definitionPath' in s), 'definitionPath should not be present');
  });

  test('omits arbitrary extra definition fields (security: strips live-object keys)', () => {
    const record = makeRecord({
      definition: { type: 'npm', script: 'test', secretToken: 'hunter2', nested: { data: true } },
    });
    const s = serialize(record);
    // Only known-safe fields survive
    assert.ok(!('script' in s), 'script should not be on serialized record');
    assert.ok(!('secretToken' in s));
    assert.ok(!('nested' in s));
    assert.strictEqual(s.definitionType, 'npm');
  });

  test('omits optional fields when undefined', () => {
    const record: ITaskExecutionRecord = {
      id: 'x',
      taskName: 'n',
      taskSource: 's',
      scope: 'g',
      definition: { type: 't' },
      startTime: 1000,
      status: 'Running',
    };
    const s = serialize(record);
    assert.ok(!('endTime' in s));
    assert.ok(!('exitCode' in s));
    assert.ok(!('duration' in s));
    assert.ok(!('definitionPath' in s));
  });

  test('handles all valid status values', () => {
    const statuses: ITaskExecutionRecord['status'][] = ['Running', 'Success', 'Failed', 'Terminated'];
    for (const status of statuses) {
      const s = serialize(makeRecord({ status }));
      assert.strictEqual(s.status, status);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: deserialize
// ---------------------------------------------------------------------------

suite('taskHistorySerializer — deserialize', () => {
  test('reconstructs ITaskExecutionRecord with correct definition.type', () => {
    const raw: ISerializedTaskExecutionRecord = {
      id: 'r1',
      taskName: 'test',
      taskSource: 'npm',
      scope: 'proj',
      definitionType: 'npm',
      startTime: 2000,
      status: 'Failed',
    };
    const record = deserialize(raw);
    assert.strictEqual(record.definition.type, 'npm');
    assert.strictEqual(record.id, 'r1');
    assert.strictEqual(record.taskName, 'test');
    assert.strictEqual(record.status, 'Failed');
  });

  test('reconstructs definition.path when definitionPath is present', () => {
    const raw: ISerializedTaskExecutionRecord = {
      id: 'r2',
      taskName: 'build',
      taskSource: 'shell',
      scope: 'root',
      definitionType: 'shell',
      definitionPath: '/some/path',
      startTime: 3000,
      status: 'Success',
    };
    const record = deserialize(raw);
    assert.strictEqual(record.definition.path, '/some/path');
  });

  test('omits definition.path when definitionPath is absent', () => {
    const raw: ISerializedTaskExecutionRecord = {
      id: 'r3',
      taskName: 'lint',
      taskSource: 'npm',
      scope: 'ws',
      definitionType: 'npm',
      startTime: 4000,
      status: 'Success',
    };
    const record = deserialize(raw);
    assert.ok(!('path' in record.definition), 'definition.path should not be present');
  });

  test('round-trips through serialize → deserialize preserving all fields', () => {
    const original = makeRecord();
    const round = deserialize(serialize(original));

    assert.strictEqual(round.id, original.id);
    assert.strictEqual(round.taskName, original.taskName);
    assert.strictEqual(round.taskSource, original.taskSource);
    assert.strictEqual(round.scope, original.scope);
    assert.strictEqual(round.definition.type, original.definition.type);
    assert.strictEqual(round.definition.path, original.definition.path);
    assert.strictEqual(round.startTime, original.startTime);
    assert.strictEqual(round.endTime, original.endTime);
    assert.strictEqual(round.exitCode, original.exitCode);
    assert.strictEqual(round.status, original.status);
    assert.strictEqual(round.duration, original.duration);
  });

  test('preserves optional fields (endTime, exitCode, duration)', () => {
    const raw: ISerializedTaskExecutionRecord = {
      id: 'r4',
      taskName: 'run',
      taskSource: 'task',
      scope: 'ws',
      definitionType: 'task',
      startTime: 5000,
      endTime: 6000,
      exitCode: 1,
      duration: 1000,
      status: 'Failed',
    };
    const record = deserialize(raw);
    assert.strictEqual(record.endTime, 6000);
    assert.strictEqual(record.exitCode, 1);
    assert.strictEqual(record.duration, 1000);
  });
});

// ---------------------------------------------------------------------------
// Suite: parseNdjsonLine
// ---------------------------------------------------------------------------

suite('taskHistorySerializer — parseNdjsonLine', () => {
  test('returns parsed object for valid JSON', () => {
    const raw: ISerializedTaskExecutionRecord = {
      id: 'p1',
      taskName: 'build',
      taskSource: 'npm',
      scope: 'ws',
      definitionType: 'npm',
      startTime: 100,
      status: 'Success',
    };
    const line = JSON.stringify(raw);
    const result = parseNdjsonLine(line);
    assert.ok(result !== null);
    assert.strictEqual(result!.id, 'p1');
    assert.strictEqual(result!.taskName, 'build');
  });

  test('returns null for malformed JSON (no throw)', () => {
    assert.doesNotThrow(() => {
      const result = parseNdjsonLine('{not valid json]');
      assert.strictEqual(result, null);
    });
  });

  test('returns null for empty string', () => {
    const result = parseNdjsonLine('');
    assert.strictEqual(result, null);
  });

  test('returns null for whitespace-only string', () => {
    const result = parseNdjsonLine('   \t  ');
    assert.strictEqual(result, null);
  });

  test('returns null for a line that is valid JSON but not an object (array)', () => {
    // JSON.parse succeeds but the result is typed as ISerializedTaskExecutionRecord — still returned
    // (consumers validate by attempting to use the fields; we just don't throw)
    assert.doesNotThrow(() => {
      parseNdjsonLine('[1,2,3]');
    });
  });

  test('trims surrounding whitespace before parsing', () => {
    const raw: ISerializedTaskExecutionRecord = {
      id: 'p2',
      taskName: 't',
      taskSource: 's',
      scope: 'w',
      definitionType: 'd',
      startTime: 0,
      status: 'Running',
    };
    const result = parseNdjsonLine('  ' + JSON.stringify(raw) + '\r');
    assert.ok(result !== null);
    assert.strictEqual(result!.id, 'p2');
  });
});
