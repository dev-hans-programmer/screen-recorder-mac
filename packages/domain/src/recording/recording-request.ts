import type { CaptureRegion } from '../capture/capture-region';
import type { CaptureSource } from '../capture/capture-source';
import { DomainError } from '../errors/domain-error';
import {
  type FrameRate,
  type RecordingProfileId,
  type RecordingResolution,
  getRecordingProfile,
} from './recording-profile';

export interface AudioCaptureRequest {
  readonly systemAudio: boolean;
  readonly microphone: boolean;
  readonly microphoneDeviceId?: string;
}

export interface RecordingRequest {
  readonly source: CaptureSource;
  readonly region: CaptureRegion | undefined;
  readonly profileId: RecordingProfileId;
  readonly resolution: RecordingResolution;
  readonly frameRate: FrameRate;
  readonly audio: AudioCaptureRequest;
  readonly showsCursor: boolean;
  readonly showsMouseClicks: boolean;
}

export function createRecordingRequest(input: RecordingRequest): RecordingRequest {
  getRecordingProfile(input.profileId);

  if (input.source.kind === 'region' && input.region === undefined) {
    throw new DomainError(
      'INVALID_REGION',
      'A region capture source requires a selected capture region.',
    );
  }

  if (input.audio.microphoneDeviceId?.trim() === '') {
    throw new DomainError('INVALID_VALUE', 'A microphone device id cannot be empty.');
  }

  return Object.freeze({
    ...input,
    audio: Object.freeze({ ...input.audio }),
  });
}
