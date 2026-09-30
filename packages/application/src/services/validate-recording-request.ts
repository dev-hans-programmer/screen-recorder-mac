import {
  createRecordingRequest,
  assertCaptureRegionFitsWithin,
  type FrameRate,
  type PixelDimensions,
  type RecordingProfileId,
  type RecordingRequest,
  type RecordingResolution,
  DomainError,
  getRecordingProfile,
} from '@screen-recorder/domain';

import type { CaptureCapabilities } from '../ports/capture-port';

export interface RecordingValidationWarning {
  readonly code:
    'PROFILE_FALLBACK' | 'FRAME_RATE_FALLBACK' | 'SYSTEM_AUDIO_DISABLED' | 'MICROPHONE_DISABLED';
  readonly message: string;
}

export interface ValidatedRecordingRequest {
  readonly requested: RecordingRequest;
  readonly effective: RecordingRequest;
  readonly outputDimensions: PixelDimensions;
  readonly warnings: readonly RecordingValidationWarning[];
}

function fitWithin(source: PixelDimensions, maximum: PixelDimensions): PixelDimensions {
  const scale = Math.min(1, maximum.width / source.width, maximum.height / source.height);

  return {
    // Video encoders and the native service require even raster dimensions.
    width: Math.max(2, Math.floor(source.width * scale) - (Math.floor(source.width * scale) % 2)),
    height: Math.max(
      2,
      Math.floor(source.height * scale) - (Math.floor(source.height * scale) % 2),
    ),
  };
}

function getRequestedDimensions(request: RecordingRequest): PixelDimensions {
  if (request.region !== undefined) {
    return {
      width: Math.round(request.region.width),
      height: Math.round(request.region.height),
    };
  }

  if (request.source.dimensions === undefined) {
    throw new DomainError(
      'SOURCE_DIMENSIONS_UNKNOWN',
      'The selected capture source has no known pixel dimensions.',
    );
  }

  return request.source.dimensions;
}

function getResolutionMaximum(resolution: RecordingResolution): PixelDimensions {
  if (resolution === '1080p') {
    return { width: 1920, height: 1080 };
  }

  return { width: 3840, height: 2160 };
}

function resolveProfileId(
  requested: RecordingProfileId,
  supported: readonly RecordingProfileId[],
): RecordingProfileId {
  const fallbackOrder: readonly RecordingProfileId[] =
    requested === 'master'
      ? ['master', 'balanced', 'compatible']
      : requested === 'balanced'
        ? ['balanced', 'compatible']
        : ['compatible'];

  const resolved = fallbackOrder.find((profileId) => supported.includes(profileId));

  if (resolved === undefined) {
    throw new DomainError('UNSUPPORTED_PROFILE', 'No supported recording profile is available.', {
      requested,
      supported,
    });
  }

  return resolved;
}

function resolveFrameRate(requested: FrameRate, supported: readonly FrameRate[]): FrameRate {
  if (supported.includes(requested)) {
    return requested;
  }

  if (requested === 60 && supported.includes(30)) {
    return 30;
  }

  throw new DomainError('UNSUPPORTED_FRAME_RATE', 'The requested frame rate is not supported.', {
    requested,
    supported,
  });
}

export function validateRecordingRequest(
  request: RecordingRequest,
  capabilities: CaptureCapabilities,
): ValidatedRecordingRequest {
  const requested = createRecordingRequest(request);

  if (requested.region !== undefined && requested.source.dimensions !== undefined) {
    assertCaptureRegionFitsWithin(requested.region, requested.source.dimensions);
  }
  const warnings: RecordingValidationWarning[] = [];
  const requestedProfile = getRecordingProfile(requested.profileId);
  const profileId = resolveProfileId(requested.profileId, capabilities.supportedProfileIds);
  const frameRate = resolveFrameRate(requested.frameRate, capabilities.supportedFrameRates);
  const requestedDimensions = getRequestedDimensions(requested);
  const profile = getRecordingProfile(profileId);
  const resolutionMaximum = getResolutionMaximum(requested.resolution);
  const outputDimensions = fitWithin(requestedDimensions, {
    width: Math.min(
      profile.maxWidth,
      capabilities.maxOutputDimensions.width,
      resolutionMaximum.width,
    ),
    height: Math.min(
      profile.maxHeight,
      capabilities.maxOutputDimensions.height,
      resolutionMaximum.height,
    ),
  });

  if (profileId !== requested.profileId) {
    warnings.push({
      code: 'PROFILE_FALLBACK',
      message: `${requestedProfile.label} is unavailable. Using ${profile.label} instead.`,
    });
  }

  if (frameRate !== requested.frameRate) {
    warnings.push({
      code: 'FRAME_RATE_FALLBACK',
      message: `${requested.frameRate} FPS is unavailable. Using ${frameRate} FPS instead.`,
    });
  }

  const systemAudio = requested.audio.systemAudio && capabilities.supportsSystemAudio;
  const microphone = requested.audio.microphone && capabilities.supportsMicrophone;

  if (requested.audio.systemAudio && !systemAudio) {
    warnings.push({
      code: 'SYSTEM_AUDIO_DISABLED',
      message: 'System audio is unavailable for this source or hardware.',
    });
  }

  if (requested.audio.microphone && !microphone) {
    warnings.push({
      code: 'MICROPHONE_DISABLED',
      message: 'Microphone capture is unavailable for this source or hardware.',
    });
  }

  return {
    requested,
    effective: createRecordingRequest({
      ...requested,
      profileId,
      frameRate,
      audio: {
        ...requested.audio,
        systemAudio,
        microphone,
        microphoneDeviceId: microphone ? requested.audio.microphoneDeviceId : undefined,
      },
    }),
    outputDimensions,
    warnings,
  };
}
