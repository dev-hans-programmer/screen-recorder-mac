import type {
  AppPreferences,
  RecordingArtifact,
  RecordingDiagnostics,
  RecordingMetadata,
  RecordingSession,
} from '@screen-recorder/domain';

export interface RecordingSessionRepository {
  findActive(): Promise<RecordingSession | undefined>;
  findById(id: string): Promise<RecordingSession | undefined>;
  save(session: RecordingSession): Promise<void>;
}

export interface RecordingCatalogRepository {
  list(): Promise<readonly RecordingMetadata[]>;
  findById(id: string): Promise<RecordingMetadata | undefined>;
  save(recording: RecordingMetadata): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface PreferencesRepository {
  get(): Promise<AppPreferences>;
  save(preferences: AppPreferences): Promise<void>;
}

export interface RecordingDiagnosticsRepository {
  listRecent(limit: number): Promise<readonly RecordingDiagnostics[]>;
  save(diagnostics: RecordingDiagnostics): Promise<void>;
}

/** Port names used by the application layer stay independent of persistence technology. */
export type RecordingRepository = RecordingSessionRepository & RecordingCatalogRepository;

export type SettingsRepository = PreferencesRepository;

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  next(): string;
}

export interface ApplicationEventPublisher {
  publish(event: ApplicationEvent): void;
}

export type ApplicationEvent =
  | RecordingStateChangedEvent
  | RecordingCompletedEvent
  | RecordingFailedEvent
  | RecordingWarningEvent
  | RecordingProgressEvent
  | DroppedFramesWarningEvent
  | DiskSpaceWarningEvent
  | PermissionChangedEvent
  | NativeServiceFailureEvent;

interface VersionedApplicationEvent {
  readonly version: 1;
}

export interface RecordingStateChangedEvent extends VersionedApplicationEvent {
  readonly type: 'recording.state-changed';
  readonly sessionId: string;
  readonly state: RecordingSession['state'];
  readonly occurredAt: number;
}

export interface RecordingCompletedEvent extends VersionedApplicationEvent {
  readonly type: 'recording.completed';
  readonly sessionId: string;
  readonly artifact: RecordingArtifact;
  readonly occurredAt: number;
}

export interface RecordingFailedEvent extends VersionedApplicationEvent {
  readonly type: 'recording.failed';
  readonly sessionId: string;
  readonly reason: string;
  readonly occurredAt: number;
}

export interface RecordingWarningEvent extends VersionedApplicationEvent {
  readonly type: 'recording.warning';
  readonly sessionId: string | undefined;
  readonly code: string;
  readonly message: string;
  readonly occurredAt: number;
}

export interface RecordingProgressEvent extends VersionedApplicationEvent {
  readonly type: 'recording.progress';
  readonly sessionId: string;
  readonly durationMs: number;
  readonly encodedBytes: number;
  readonly occurredAt: number;
}

export interface DroppedFramesWarningEvent extends VersionedApplicationEvent {
  readonly type: 'recording.dropped-frames';
  readonly sessionId: string;
  readonly droppedFrames: number;
  readonly totalFrames: number;
  readonly occurredAt: number;
}

export interface DiskSpaceWarningEvent extends VersionedApplicationEvent {
  readonly type: 'recording.disk-space-warning';
  readonly sessionId: string | undefined;
  readonly availableBytes: number;
  readonly estimatedRequiredBytes: number;
  readonly occurredAt: number;
}

export interface PermissionChangedEvent extends VersionedApplicationEvent {
  readonly type: 'permissions.changed';
  readonly screenRecording: string;
  readonly microphone: string;
  readonly screenRecordingRequiresRestart: boolean;
  readonly occurredAt: number;
}

export interface NativeServiceFailureEvent extends VersionedApplicationEvent {
  readonly type: 'native-service.failed';
  readonly sessionId: string | undefined;
  readonly operation: string;
  readonly message: string;
  readonly occurredAt: number;
}
