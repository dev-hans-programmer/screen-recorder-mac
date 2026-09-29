import type {
  AppPreferencesDto,
  AppPreferencesPatchDto,
  CaptureRegionDto,
  CapturePermissionsDto,
  CaptureSourceDto,
  IpcEvent,
  IpcResponse,
  RecordingArtifactDto,
  RecordingRequestDto,
  ShortcutAction,
} from '@screen-recorder/contracts';

type ValidatedRecordingRequestDto = IpcResponse<'recording.validate-request'>['data'];
type StartRecordingResponseDto = IpcResponse<'recording.start'>['data'];

export interface ScreenRecorderApi {
  listCaptureSources(): Promise<readonly CaptureSourceDto[]>;
  getCapturePermissions(): Promise<CapturePermissionsDto>;
  requestCapturePermissions(request: {
    readonly microphone: boolean;
  }): Promise<CapturePermissionsDto>;
  selectRegion(displayId: string): Promise<CaptureRegionDto | null>;
  submitRegionSelection(region: CaptureRegionDto): void;
  cancelRegionSelection(): void;
  validateRecordingRequest(request: RecordingRequestDto): Promise<ValidatedRecordingRequestDto>;
  startRecording(request: RecordingRequestDto): Promise<StartRecordingResponseDto>;
  pauseRecording(sessionId: string): Promise<void>;
  resumeRecording(sessionId: string): Promise<void>;
  stopRecording(sessionId: string): Promise<RecordingArtifactDto>;
  listRecordings(): Promise<readonly RecordingArtifactDto[]>;
  getPreferences(): Promise<AppPreferencesDto>;
  updatePreferences(patch: AppPreferencesPatchDto): Promise<AppPreferencesDto>;
  onEvent(listener: (event: IpcEvent) => void): () => void;
  onShortcut(listener: (action: ShortcutAction) => void): () => void;
}

declare global {
  interface Window {
    readonly screenRecorder: ScreenRecorderApi;
  }
}
