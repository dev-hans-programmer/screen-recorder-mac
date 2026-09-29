export type DomainErrorCode =
  | 'INVALID_VALUE'
  | 'INVALID_CAPTURE_SOURCE'
  | 'INVALID_REGION'
  | 'INVALID_RECORDING_PROFILE'
  | 'INVALID_RECORDING_STATE'
  | 'RECORDING_ALREADY_ACTIVE'
  | 'RECORDING_NOT_FOUND'
  | 'SCREEN_RECORDING_PERMISSION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED_PROFILE'
  | 'UNSUPPORTED_CODEC'
  | 'UNSUPPORTED_FRAME_RATE'
  | 'UNSUPPORTED_AUDIO'
  | 'INSUFFICIENT_DISK_SPACE'
  | 'HELPER_FAILURE'
  | 'SOURCE_DIMENSIONS_UNKNOWN'
  | 'NATIVE_SERVICE_FAILURE'
  | 'RECORDING_FINALIZATION_FAILURE'
  | 'FINALIZATION_FAILURE'
  | 'RECOVERY_REQUIRED'
  | 'INVALID_PREFERENCES';

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    code: DomainErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
