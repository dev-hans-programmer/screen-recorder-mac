import { DomainError } from '../errors/domain-error';
export { createFrameRate } from './frame-rate';
export type { FrameRate } from './frame-rate';

export type RecordingProfileId = 'compatible' | 'balanced' | 'master';
export type RecordingCodec = 'h264' | 'hevc' | 'prores422';
export type RecordingContainer = 'mp4' | 'mov';
export type RecordingResolution = 'source' | '1080p' | '4k';
export interface RecordingProfile {
  readonly id: RecordingProfileId;
  readonly label: string;
  readonly codec: RecordingCodec;
  readonly container: RecordingContainer;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly supportsHdr: boolean;
}

const profiles: Readonly<Record<RecordingProfileId, RecordingProfile>> = Object.freeze({
  compatible: Object.freeze({
    id: 'compatible',
    label: 'Compatible',
    codec: 'h264',
    container: 'mp4',
    maxWidth: 3840,
    maxHeight: 2160,
    supportsHdr: false,
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    codec: 'hevc',
    container: 'mp4',
    maxWidth: 3840,
    maxHeight: 2160,
    supportsHdr: true,
  }),
  master: Object.freeze({
    id: 'master',
    label: 'Master',
    codec: 'prores422',
    container: 'mov',
    maxWidth: 3840,
    maxHeight: 2160,
    supportsHdr: true,
  }),
});

export const recordingProfileIds: readonly RecordingProfileId[] = Object.freeze([
  'compatible',
  'balanced',
  'master',
]);

export function getRecordingProfile(profileId: RecordingProfileId): RecordingProfile {
  const profile = profiles[profileId];

  if (profile === undefined) {
    throw new DomainError('INVALID_RECORDING_PROFILE', `Unknown recording profile: ${profileId}.`);
  }

  return profile;
}

export function isRecordingProfileId(value: string): value is RecordingProfileId {
  return recordingProfileIds.includes(value as RecordingProfileId);
}
