import { DomainError } from '../errors/domain-error';
import { createDurationMs, type DurationMs } from './duration';

export interface RecordingStatistics {
  readonly durationMs: DurationMs;
  readonly capturedFrames: number;
  readonly encodedFrames: number;
  readonly droppedFrames: number;
  readonly encodedBytes: number;
}

export const emptyRecordingStatistics: RecordingStatistics = Object.freeze({
  durationMs: createDurationMs(0),
  capturedFrames: 0,
  encodedFrames: 0,
  droppedFrames: 0,
  encodedBytes: 0,
});

export function createRecordingStatistics(input: RecordingStatistics): RecordingStatistics {
  const counters = [
    input.capturedFrames,
    input.encodedFrames,
    input.droppedFrames,
    input.encodedBytes,
  ];

  if (counters.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new DomainError('INVALID_VALUE', 'Recording statistics must be finite and non-negative.');
  }

  return Object.freeze({
    ...input,
    durationMs: createDurationMs(input.durationMs),
  });
}
