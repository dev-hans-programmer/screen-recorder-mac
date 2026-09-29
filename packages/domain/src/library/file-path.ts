import { DomainError } from '../errors/domain-error';

/** A validated path is kept opaque so infrastructure owns filesystem-specific operations. */
export type RecordingFilePath = string & { readonly __brand: 'RecordingFilePath' };

export function createRecordingFilePath(value: string): RecordingFilePath {
  if (value.trim().length === 0) {
    throw new DomainError('INVALID_VALUE', 'A recording file path cannot be empty.');
  }

  return value as RecordingFilePath;
}
