import { DomainError } from '../errors/domain-error';
import type { RecordingCodec } from '../recording/recording-profile';

export type AudioTrackState = 'disabled' | 'active' | 'empty';
export type EncoderKind = 'hardware' | 'software';

/** Path-free metrics that are safe to retain and include in a support report. */
export interface RecordingDiagnostics {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly recordedAt: number;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly capturedFrameCount: number;
  readonly actualFrameCount: number;
  readonly droppedFrameCount: number;
  readonly codec: RecordingCodec;
  readonly encoder: EncoderKind;
  readonly systemAudio: AudioTrackState;
  readonly microphone: AudioTrackState;
  readonly fileSizeBytes: number;
  readonly averageFileWriteBytesPerSecond: number;
  readonly peakFileWriteBytesPerSecond: number;
}

export function createRecordingDiagnostics(input: RecordingDiagnostics): RecordingDiagnostics {
  if (input.sessionId.trim().length === 0) {
    throw new DomainError('INVALID_VALUE', 'Recording diagnostics require a session id.');
  }

  const finiteValues = [
    input.recordedAt,
    input.width,
    input.height,
    input.durationMs,
    input.capturedFrameCount,
    input.actualFrameCount,
    input.droppedFrameCount,
    input.fileSizeBytes,
    input.averageFileWriteBytesPerSecond,
    input.peakFileWriteBytesPerSecond,
  ];
  if (finiteValues.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new DomainError(
      'INVALID_VALUE',
      'Recording diagnostic measurements must be finite and non-negative.',
    );
  }
  if (input.width < 1 || input.height < 1) {
    throw new DomainError('INVALID_VALUE', 'Recording diagnostic dimensions must be positive.');
  }
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    !Number.isInteger(input.capturedFrameCount) ||
    !Number.isInteger(input.actualFrameCount) ||
    !Number.isInteger(input.droppedFrameCount)
  ) {
    throw new DomainError('INVALID_VALUE', 'Recording diagnostic counters must be integers.');
  }
  if (!['h264', 'hevc', 'prores422'].includes(input.codec)) {
    throw new DomainError('INVALID_VALUE', 'Recording diagnostics contain an unknown codec.');
  }
  if (!['hardware', 'software'].includes(input.encoder)) {
    throw new DomainError('INVALID_VALUE', 'Recording diagnostics contain an unknown encoder.');
  }
  if (
    !['disabled', 'active', 'empty'].includes(input.systemAudio) ||
    !['disabled', 'active', 'empty'].includes(input.microphone)
  ) {
    throw new DomainError('INVALID_VALUE', 'Recording diagnostics contain an unknown audio state.');
  }

  return Object.freeze({ ...input });
}
