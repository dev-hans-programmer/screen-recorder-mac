export type PermissionState = 'not-determined' | 'granted' | 'denied' | 'restricted';

export interface CapturePermissions {
  readonly screenRecording: PermissionState;
  readonly microphone: PermissionState;
}

export function canCaptureScreen(permissions: CapturePermissions): boolean {
  return permissions.screenRecording === 'granted';
}

export function missingPermissionNames(
  permissions: CapturePermissions,
  microphoneRequested: boolean,
): readonly string[] {
  const missing: string[] = [];

  if (!canCaptureScreen(permissions)) {
    missing.push('Screen Recording');
  }

  if (microphoneRequested && permissions.microphone !== 'granted') {
    missing.push('Microphone');
  }

  return missing;
}
