import type {
  CaptureSource,
  FrameRate,
  PixelDimensions,
  RecordingProfileId,
} from '@screen-recorder/domain';

import type { PermissionPort } from './permission-port';

export interface CaptureCapabilities {
  readonly maxOutputDimensions: PixelDimensions;
  readonly supportedProfileIds: readonly RecordingProfileId[];
  readonly supportedFrameRates: readonly FrameRate[];
  readonly supportsSystemAudio: boolean;
  readonly supportsMicrophone: boolean;
}

export interface CapturePermissionRequest {
  readonly microphone: boolean;
}

export interface CapturePort extends PermissionPort {
  listSources(): Promise<readonly CaptureSource[]>;
  getCapabilities(): Promise<CaptureCapabilities>;
}
