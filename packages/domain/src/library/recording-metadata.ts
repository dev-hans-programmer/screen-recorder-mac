import { DomainError } from '../errors/domain-error';
import type { RecordingFilePath } from './file-path';
import { createRecordingArtifact, type RecordingArtifact } from './recording-artifact';

export const recordingMetadataSchemaVersion = 1 as const;

export type RecordingAvailability = 'available' | 'missing';

export interface RecordingFailureMetadata {
  readonly reason: string;
  readonly occurredAt: number;
  readonly recoverable: boolean;
}

export interface RecordingRecoveryMetadata {
  readonly recoveredAt: number;
  readonly originalFilePath: RecordingFilePath;
}

/**
 * Versioned library metadata is deliberately separate from the capture artifact. Availability is
 * refreshed from the filesystem, while failure/recovery fields preserve future recovery history.
 */
export interface RecordingMetadata extends RecordingArtifact {
  readonly schemaVersion: typeof recordingMetadataSchemaVersion;
  readonly availability: RecordingAvailability;
  readonly failure: RecordingFailureMetadata | undefined;
  readonly recovery: RecordingRecoveryMetadata | undefined;
}

export function normalizeRecordingTitle(value: string): string {
  const title = value.trim();

  if (title.length === 0 || title.length > 180 || /[/:\0]/u.test(title)) {
    throw new DomainError(
      'INVALID_VALUE',
      'Recording names must be 1–180 characters and cannot contain “/” or “:”.',
    );
  }

  return title;
}

export function createRecordingMetadata(
  input: Omit<RecordingMetadata, 'title'> & { readonly title: string },
): RecordingMetadata {
  if (input.schemaVersion !== recordingMetadataSchemaVersion) {
    throw new DomainError('INVALID_VALUE', 'The recording metadata schema version is unsupported.');
  }

  if (input.failure !== undefined) {
    if (input.failure.reason.trim().length === 0 || !Number.isFinite(input.failure.occurredAt)) {
      throw new DomainError('INVALID_VALUE', 'Recording failure metadata is invalid.');
    }
  }

  if (input.recovery !== undefined && !Number.isFinite(input.recovery.recoveredAt)) {
    throw new DomainError('INVALID_VALUE', 'Recording recovery metadata is invalid.');
  }

  const artifact = createRecordingArtifact({
    ...input,
    title: normalizeRecordingTitle(input.title),
  });
  return Object.freeze({
    ...artifact,
    schemaVersion: input.schemaVersion,
    availability: input.availability,
    failure: input.failure,
    recovery: input.recovery,
  });
}

export function createRecordingMetadataFromArtifact(
  artifact: RecordingArtifact,
): RecordingMetadata {
  return createRecordingMetadata({
    ...artifact,
    schemaVersion: recordingMetadataSchemaVersion,
    availability: 'available',
    failure: undefined,
    recovery: undefined,
  });
}
