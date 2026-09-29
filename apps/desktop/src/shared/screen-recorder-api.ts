import type {
  AppPreferencesDto,
  AppPreferencesPatchDto,
  CapturePermissionsDto,
  CaptureSourceDto,
  IpcEvent,
  IpcResponse,
  RecordingArtifactDto,
  RecordingRequestDto,
} from '@screen-recorder/contracts';

type ValidatedRecordingRequestDto = IpcResponse<'recording.validate-request'>['data'];
type StartRecordingResponseDto = IpcResponse<'recording.start'>['data'];

export interface ScreenRecorderApi {
  listCaptureSources(): Promise<readonly CaptureSourceDto[]>;
  getCapturePermissions(): Promise<CapturePermissionsDto>;
  requestCapturePermissions(request: {
    readonly microphone: boolean;
  }): Promise<CapturePermissionsDto>;
  validateRecordingRequest(request: RecordingRequestDto): Promise<ValidatedRecordingRequestDto>;
  startRecording(request: RecordingRequestDto): Promise<StartRecordingResponseDto>;
  pauseRecording(sessionId: string): Promise<void>;
  resumeRecording(sessionId: string): Promise<void>;
  stopRecording(sessionId: string): Promise<RecordingArtifactDto>;
  listRecordings(): Promise<readonly RecordingArtifactDto[]>;
  getPreferences(): Promise<AppPreferencesDto>;
  updatePreferences(patch: AppPreferencesPatchDto): Promise<AppPreferencesDto>;
  onEvent(listener: (event: IpcEvent) => void): () => void;
}

declare global {
  interface Window {
    readonly screenRecorder: ScreenRecorderApi;
  }
}
