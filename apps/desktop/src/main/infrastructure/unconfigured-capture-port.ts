import { type CapturePort, type CaptureCapabilities } from '@screen-recorder/application';
import type { CapturePermissions, CaptureSource } from '@screen-recorder/domain';

const unavailablePermissions: CapturePermissions = Object.freeze({
  screenRecording: 'not-determined',
  microphone: 'not-determined',
  screenRecordingRequiresRestart: false,
});

const unavailableCapabilities: CaptureCapabilities = Object.freeze({
  maxOutputDimensions: Object.freeze({ width: 3840, height: 2160 }),
  supportedProfileIds: Object.freeze(['compatible', 'balanced', 'master'] as const),
  supportedFrameRates: Object.freeze([30, 60] as const),
  supportsSystemAudio: false,
  supportsMicrophone: false,
});

/** Phase 3 composition keeps the app usable before the Swift service exists in Phase 4. */
export class UnconfiguredCapturePort implements CapturePort {
  public listSources(): Promise<readonly CaptureSource[]> {
    return Promise.resolve([]);
  }

  public getPermissions(): Promise<CapturePermissions> {
    return Promise.resolve(unavailablePermissions);
  }

  public requestPermissions(): Promise<CapturePermissions> {
    return Promise.resolve(unavailablePermissions);
  }

  public getCapabilities(): Promise<CaptureCapabilities> {
    return Promise.resolve(unavailableCapabilities);
  }
}
