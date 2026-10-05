import type {
  AppPreferencesDto,
  AppPreferencesPatchDto,
  CaptureRegionDto,
  CapturePermissionsDto,
  CaptureSourceDto,
  EditingProjectDto,
  IpcEvent,
  IpcResponse,
  RecordingArtifactDto,
  RecordingEditRequestDto,
  RecordingMetadataDto,
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
  listRecordings(): Promise<readonly RecordingMetadataDto[]>;
  getRecordingThumbnail(recordingId: string): Promise<string | null>;
  getRecordingMediaUrl(recordingId: string): Promise<string>;
  exportEditedRecording(edit: RecordingEditRequestDto): Promise<RecordingMetadataDto>;
  loadEditingProject(recordingId: string): Promise<EditingProjectDto>;
  saveEditingProject(project: EditingProjectDto): Promise<EditingProjectDto>;
  renameRecording(recordingId: string, title: string): Promise<RecordingMetadataDto>;
  openRecording(recordingId: string): Promise<void>;
  revealRecording(recordingId: string): Promise<void>;
  deleteRecording(recordingId: string): Promise<void>;
  openRecordingsFolder(): Promise<void>;
  openPermissionSettings(target: 'screen-recording' | 'microphone'): Promise<void>;
  relaunchApplication(): Promise<void>;
  exportDiagnostics(): Promise<string | null>;
  getPreferences(): Promise<AppPreferencesDto>;
  chooseOutputDirectory(): Promise<AppPreferencesDto | null>;
  updatePreferences(patch: AppPreferencesPatchDto): Promise<AppPreferencesDto>;
  onEvent(listener: (event: IpcEvent) => void): () => void;
  onShortcut(listener: (action: ShortcutAction) => void): () => void;
}

declare global {
  interface Window {
    readonly screenRecorder: ScreenRecorderApi;
  }
}
