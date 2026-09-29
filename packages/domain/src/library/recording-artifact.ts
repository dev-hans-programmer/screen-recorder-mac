import { DomainError } from '../errors/domain-error';
import type { DurationMs } from '../recording/duration';
import type { FrameRate, RecordingCodec, RecordingProfileId } from '../recording/recording-profile';
import type { RecordingFilePath } from './file-path';

export interface RecordingArtifact {
  readonly id: string;
  readonly filePath: RecordingFilePath;
  readonly title: string;
  readonly createdAt: number;
  readonly durationMs: DurationMs;
  readonly width: number;
  readonly height: number;
  readonly frameRate: FrameRate;
  readonly profileId: RecordingProfileId;
  readonly codec: RecordingCodec;
  readonly hasSystemAudio: boolean;
  readonly hasMicrophone: boolean;
  readonly fileSizeBytes: number;
}

export function createRecordingArtifact(input: RecordingArtifact): RecordingArtifact {
  if (input.id.trim().length === 0) {
    throw new DomainError('INVALID_VALUE', 'A recording artifact requires an id and file path.');
  }

  if (input.width <= 0 || input.height <= 0 || input.fileSizeBytes < 0) {
    throw new DomainError('INVALID_VALUE', 'Recording artifact measurements must be valid.');
  }

  return Object.freeze({ ...input });
}
