import * as assert from 'assert';
import { formatSeconds } from '../../common/formatSeconds';


suite('formatSeconds Test Suite', () => {
  test('formats seconds correctly when given a positive number', () => {
    const result = formatSeconds(3661 * 1000); // 1 hour, 1 minute, and 1 second in milliseconds
    assert.strictEqual(result, '1h 1m 1s');
  });

  test('formats seconds correctly when given zero', () => {
    const result = formatSeconds(0);
    assert.strictEqual(result, '0s');
  });

  test('formats seconds correctly when given a negative number', () => {
    const result = formatSeconds(-3661 * 1000); // -1 hour, -1 minute, and -1 second in milliseconds
    assert.strictEqual(result, '-1h 1m 1s');
  });

  test('formats seconds correctly when given a number less than a minute', () => {
    const result = formatSeconds(45 * 1000); // 45 seconds in milliseconds
    assert.strictEqual(result, '45s');
  });

  test('formats seconds correctly when given a number less than an hour', () => {
    const result = formatSeconds(125 * 1000); // 2 minutes and 5 seconds in milliseconds
    assert.strictEqual(result, '2m 5s');
  });

  test('formats seconds correctly when given a number with hours, minutes, and seconds', () => {
    const result = formatSeconds(7325 * 1000); // 2 hours, 2 minutes, and 5 seconds in milliseconds
    assert.strictEqual(result, '2h 2m 5s');
  });

  test('formats seconds correctly when given a number with only hours', () => {
    const result = formatSeconds(7200 * 1000); // 2 hours in milliseconds
    assert.strictEqual(result, '2h');
  });

  test('formats seconds correctly when given a number with only minutes', () => {
    const result = formatSeconds(180 * 1000); // 3 minutes in milliseconds
    assert.strictEqual(result, '3m');
  });

  test('formats seconds correctly when given a number with only seconds', () => {
    const result = formatSeconds(30 * 1000); // 30 seconds in milliseconds
    assert.strictEqual(result, '30s');
  });

  test('formats seconds correctly when given a number greater than a day', () => {
    const result = formatSeconds(90061 * 1000); // 1 day, 1 hour, 1 minute, and 1 second in milliseconds
    assert.strictEqual(result, '1d 1h 1m 1s');
  });

  test('formats seconds correctly when given a negative number greater than a day', () => {
    const result = formatSeconds(-90061 * 1000); // -1 day, -1 hour, -1 minute, and -1 second in milliseconds
    assert.strictEqual(result, '-1d 1h 1m 1s');
  });
});
