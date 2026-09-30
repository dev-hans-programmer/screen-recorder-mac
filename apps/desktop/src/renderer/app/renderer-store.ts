import { useSyncExternalStore } from 'react';

import type {
  AppPreferencesDto,
  AppPreferencesPatchDto,
  CaptureRegionDto,
  CapturePermissionsDto,
  CaptureSourceDto,
  IpcEvent,
  RecordingArtifactDto,
  RecordingMetadataDto,
  RecordingSessionSnapshotDto,
} from '@screen-recorder/contracts';

import type { ScreenRecorderApi } from '../../shared/screen-recorder-api';

export type AppScreen = 'recorder' | 'library' | 'settings';
export type RecoveryAction =
  'open-screen-settings' | 'open-microphone-settings' | 'restart-application' | 'refresh-sources';
export type Operation =
  | 'idle'
  | 'initializing'
  | 'requesting-permission'
  | 'starting'
  | 'pausing'
  | 'resuming'
  | 'stopping'
  | 'library-action'
  | 'saving-preferences'
  | 'exporting-diagnostics';

export interface RecordingProgress {
  readonly durationMs: number;
  readonly encodedBytes: number;
  readonly droppedFrames: number;
}

export interface RecordingOptions {
  readonly profileId: AppPreferencesDto['defaultProfileId'];
  readonly resolution: AppPreferencesDto['defaultResolution'];
  readonly frameRate: AppPreferencesDto['defaultFrameRate'];
  readonly systemAudio: boolean;
  readonly microphone: boolean;
  readonly showsCursor: boolean;
  readonly showsMouseClicks: boolean;
  readonly region: CaptureRegionDto | null;
}

export interface DiskSpaceStatus {
  readonly availableBytes: number;
  readonly estimatedRequiredBytes: number;
}

export interface RendererState {
  readonly activeScreen: AppScreen;
  readonly initialized: boolean;
  readonly sources: readonly CaptureSourceDto[];
  readonly selectedSourceId: string | null;
  readonly permissions: CapturePermissionsDto | null;
  readonly preferences: AppPreferencesDto | null;
  readonly recordings: readonly RecordingMetadataDto[];
  readonly recordingOptions: RecordingOptions;
  readonly activeSession: RecordingSessionSnapshotDto | null;
  readonly recordingState: RecordingSessionSnapshotDto['state'] | 'idle';
  readonly progress: RecordingProgress;
  readonly diskSpace: DiskSpaceStatus | null;
  readonly operation: Operation;
  readonly error: string | null;
  readonly notice: string | null;
  readonly recoveryAction: RecoveryAction | null;
}

const initialState: RendererState = {
  activeScreen: 'recorder',
  initialized: false,
  sources: [],
  selectedSourceId: null,
  permissions: null,
  preferences: null,
  recordings: [],
  recordingOptions: {
    profileId: 'balanced',
    resolution: 'source',
    frameRate: 60,
    systemAudio: true,
    microphone: false,
    showsCursor: true,
    showsMouseClicks: false,
    region: null,
  },
  activeSession: null,
  recordingState: 'idle',
  progress: { durationMs: 0, encodedBytes: 0, droppedFrames: 0 },
  diskSpace: null,
  operation: 'idle',
  error: null,
  notice: null,
  recoveryAction: null,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function withRecording(
  recordings: readonly RecordingMetadataDto[],
  recording: RecordingMetadataDto,
): readonly RecordingMetadataDto[] {
  return [recording, ...recordings.filter((candidate) => candidate.id !== recording.id)];
}

function metadataFromArtifact(artifact: RecordingArtifactDto): RecordingMetadataDto {
  return {
    ...artifact,
    schemaVersion: 1,
    availability: 'available',
    failure: null,
    recovery: null,
  };
}

/**
 * Renderer-only state. Native frames never enter this store; only small metadata events do.
 * Keeping it as an external store lets React subscribe to individual fields, which is important
 * because progress events can arrive many times per second while the rest of the shell is idle.
 */
export class RendererStore {
  private state: RendererState = initialState;

  private readonly listeners = new Set<() => void>();

  private eventUnsubscribe: (() => void) | undefined;

  private shortcutUnsubscribe: (() => void) | undefined;

  private initializationPromise: Promise<void> | undefined;

  private permissionRefreshPromise: Promise<void> | undefined;

  public constructor(private readonly api: ScreenRecorderApi) {}

  public getState = (): RendererState => this.state;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public async initialize(): Promise<void> {
    if (this.initializationPromise !== undefined) {
      return this.initializationPromise;
    }

    this.setState({ operation: 'initializing', error: null });
    this.eventUnsubscribe ??= this.api.onEvent((event) => this.handleEvent(event));
    this.shortcutUnsubscribe ??= this.api.onShortcut((action) => this.handleShortcut(action));

    this.initializationPromise = Promise.allSettled([
      this.api.getPreferences(),
      this.api.listCaptureSources(),
      this.api.getCapturePermissions(),
      this.api.listRecordings(),
    ])
      .then(([preferences, sources, permissions, recordings]) => {
        const failures = [preferences, sources, permissions, recordings].filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );

        const resolvedPreferences =
          preferences.status === 'fulfilled' ? preferences.value : this.state.preferences;
        this.setState({
          ...(resolvedPreferences === null ? {} : { preferences: resolvedPreferences }),
          ...(sources.status === 'fulfilled' ? this.sourceState(sources.value) : {}),
          ...(permissions.status === 'fulfilled'
            ? {
                permissions: permissions.value,
                recoveryAction: this.permissionRecoveryAction(
                  permissions.value,
                  resolvedPreferences?.microphoneEnabled ?? false,
                ),
              }
            : {}),
          ...(recordings.status === 'fulfilled' ? { recordings: recordings.value } : {}),
          ...(resolvedPreferences === null
            ? {}
            : { recordingOptions: this.optionsFromPreferences(resolvedPreferences) }),
          initialized: true,
          operation: 'idle',
          error:
            failures.length > 0
              ? errorMessage(failures[0].reason, 'Some recorder services are unavailable.')
              : null,
        });
      })
      .catch((error: unknown) => {
        this.setState({
          initialized: true,
          operation: 'idle',
          error: errorMessage(error, 'The recorder could not be initialized.'),
        });
      });

    return this.initializationPromise;
  }

  public setActiveScreen(screen: AppScreen): void {
    this.setState({ activeScreen: screen, error: null });
    if (screen === 'library') void this.refreshRecordings();
  }

  public clearFeedback(): void {
    this.setState({ error: null, notice: null, recoveryAction: null });
  }

  public selectSource(sourceId: string): void {
    const source = this.state.sources.find((candidate) => candidate.id === sourceId);
    if (source?.isAvailable === true) {
      this.setState({
        selectedSourceId: sourceId,
        recordingOptions: {
          ...this.state.recordingOptions,
          region: source.kind === 'display' ? this.state.recordingOptions.region : null,
        },
        error: null,
      });
    }
  }

  public async refreshSources(): Promise<void> {
    try {
      const sources = await this.api.listCaptureSources();
      this.setState({ ...this.sourceState(sources), error: null, recoveryAction: null });
    } catch (error: unknown) {
      this.setState({ error: errorMessage(error, 'Capture sources could not be refreshed.') });
    }
  }

  public async refreshRecordings(): Promise<void> {
    try {
      this.setState({ recordings: await this.api.listRecordings(), error: null });
    } catch (error: unknown) {
      this.setState({
        error: errorMessage(error, 'The recording library could not be refreshed.'),
      });
    }
  }

  public getRecordingThumbnail(recordingId: string): Promise<string | null> {
    return this.api.getRecordingThumbnail(recordingId);
  }

  public async renameRecording(recordingId: string, title: string): Promise<boolean> {
    this.setState({ operation: 'library-action', error: null, notice: null });
    try {
      const recording = await this.api.renameRecording(recordingId, title);
      this.setState({
        recordings: withRecording(this.state.recordings, recording),
        operation: 'idle',
        notice: 'Recording renamed.',
      });
      return true;
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'The recording could not be renamed.'),
      });
      return false;
    }
  }

  public async deleteRecording(recordingId: string): Promise<boolean> {
    const missing =
      this.state.recordings.find((recording) => recording.id === recordingId)?.availability ===
      'missing';
    this.setState({ operation: 'library-action', error: null, notice: null });
    try {
      await this.api.deleteRecording(recordingId);
      this.setState({
        recordings: this.state.recordings.filter((recording) => recording.id !== recordingId),
        operation: 'idle',
        notice: missing
          ? 'Missing recording removed from the library.'
          : 'Recording moved to Trash and removed from the library.',
      });
      return true;
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'The recording could not be deleted.'),
      });
      return false;
    }
  }

  public async openRecording(recordingId: string): Promise<void> {
    try {
      await this.api.openRecording(recordingId);
    } catch (error: unknown) {
      this.setState({ error: errorMessage(error, 'The recording could not be opened.') });
      await this.refreshRecordings();
    }
  }

  public async revealRecording(recordingId: string): Promise<void> {
    try {
      await this.api.revealRecording(recordingId);
    } catch (error: unknown) {
      this.setState({ error: errorMessage(error, 'The recording could not be revealed.') });
      await this.refreshRecordings();
    }
  }

  public async openRecordingsFolder(): Promise<void> {
    try {
      await this.api.openRecordingsFolder();
    } catch (error: unknown) {
      this.setState({ error: errorMessage(error, 'The recordings folder could not be opened.') });
    }
  }

  public setRecordingOptions(patch: Partial<RecordingOptions>): void {
    const recordingOptions = { ...this.state.recordingOptions, ...patch };
    this.setState({
      recordingOptions,
      error: null,
      recoveryAction: this.permissionRecoveryAction(
        this.state.permissions,
        recordingOptions.microphone,
      ),
    });
  }

  public async selectRegion(): Promise<void> {
    const source = this.state.sources.find(
      (candidate) => candidate.id === this.state.selectedSourceId,
    );
    if (source?.kind !== 'display') {
      this.setState({ error: 'Select a display before choosing a region.' });
      return;
    }

    try {
      const region = await this.api.selectRegion(source.id);
      if (region === null) return;
      this.setState({
        recordingOptions: { ...this.state.recordingOptions, region },
        notice: 'Region selected.',
        error: null,
      });
    } catch (error: unknown) {
      this.setState({ error: errorMessage(error, 'Region selection could not be opened.') });
    }
  }

  public clearRegion(): void {
    this.setRecordingOptions({ region: null });
  }

  public handleShortcut(action: 'toggle-start-stop' | 'toggle-pause-resume'): void {
    if (action === 'toggle-start-stop') {
      if (this.state.activeSession !== null) void this.stopRecording();
      else void this.startRecording();
      return;
    }

    if (this.state.recordingState === 'paused') void this.resumeRecording();
    else if (this.state.activeSession !== null) void this.pauseRecording();
  }

  public async refreshPermissions(silent = false): Promise<void> {
    if (this.permissionRefreshPromise !== undefined) return this.permissionRefreshPromise;
    const pending = this.refreshPermissionsInternal(silent);
    this.permissionRefreshPromise = pending;
    try {
      await pending;
    } finally {
      if (this.permissionRefreshPromise === pending) this.permissionRefreshPromise = undefined;
    }
  }

  private async refreshPermissionsInternal(silent: boolean): Promise<void> {
    try {
      const previous = this.state.permissions;
      const permissions = await this.api.getCapturePermissions();
      const revoked =
        previous?.screenRecording === 'granted' && permissions.screenRecording !== 'granted';
      const recoveryAction = this.permissionRecoveryAction(
        permissions,
        this.state.recordingOptions.microphone,
      );
      this.setState({
        permissions,
        recoveryAction,
        ...(revoked
          ? { error: 'Screen Recording access was revoked. Re-enable it in System Settings.' }
          : permissions.screenRecordingRequiresRestart
            ? { notice: 'Restart Capture to finish enabling Screen Recording.' }
            : silent
              ? {}
              : { error: null }),
      });
    } catch (error: unknown) {
      if (!silent) {
        this.setState({ error: errorMessage(error, 'Permissions could not be refreshed.') });
      }
    }
  }

  public async requestPermissions(
    microphone = this.state.recordingOptions.microphone,
  ): Promise<void> {
    this.setState({ operation: 'requesting-permission', error: null });

    try {
      const permissions = await this.api.requestCapturePermissions({
        microphone,
      });
      const recoveryAction = this.permissionRecoveryAction(permissions, microphone);
      this.setState({
        permissions,
        operation: 'idle',
        recoveryAction,
        ...(permissions.screenRecordingRequiresRestart
          ? { notice: 'Screen Recording was enabled. Restart Capture before recording.' }
          : permissions.screenRecording !== 'granted'
            ? { error: 'Allow Screen Recording in System Settings to continue.' }
            : microphone && permissions.microphone !== 'granted'
              ? { error: 'Allow Microphone access in System Settings, or continue without it.' }
              : { notice: 'Capture permissions are ready.', error: null }),
      });
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Permission request failed.'),
      });
    }
  }

  public async openPermissionSettings(target: 'screen-recording' | 'microphone'): Promise<void> {
    try {
      await this.api.openPermissionSettings(target);
      this.setState({ notice: 'System Settings opened. Return here after changing access.' });
    } catch (error: unknown) {
      this.setState({ error: errorMessage(error, 'System Settings could not be opened.') });
    }
  }

  public async relaunchApplication(): Promise<void> {
    try {
      await this.api.relaunchApplication();
    } catch (error: unknown) {
      this.setState({ error: errorMessage(error, 'Capture could not be restarted.') });
    }
  }

  public async completeOnboarding(): Promise<void> {
    await this.updatePreferences({ onboardingCompleted: true });
  }

  public async exportDiagnostics(): Promise<void> {
    this.setState({ operation: 'exporting-diagnostics', error: null });
    try {
      const filePath = await this.api.exportDiagnostics();
      this.setState({
        operation: 'idle',
        ...(filePath === null
          ? { notice: 'Diagnostics export cancelled.' }
          : { notice: 'Diagnostics report exported successfully.' }),
      });
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Diagnostics could not be exported.'),
      });
    }
  }

  public runRecoveryAction(): void {
    switch (this.state.recoveryAction) {
      case 'open-screen-settings':
        void this.openPermissionSettings('screen-recording');
        return;
      case 'open-microphone-settings':
        void this.openPermissionSettings('microphone');
        return;
      case 'restart-application':
        void this.relaunchApplication();
        return;
      case 'refresh-sources':
        void this.refreshSources();
        return;
      case null:
        return;
    }
  }

  public async startRecording(): Promise<void> {
    const source = this.state.sources.find(
      (candidate) => candidate.id === this.state.selectedSourceId,
    );
    const preferences = this.state.preferences;

    if (source === undefined || !source.isAvailable || preferences === null) {
      this.setState({ error: 'Choose an available capture source first.' });
      return;
    }

    if (this.state.permissions?.screenRecordingRequiresRestart === true) {
      this.setState({
        error: 'Restart Capture before starting your first recording.',
        recoveryAction: 'restart-application',
      });
      return;
    }

    if (this.state.permissions?.screenRecording !== 'granted') {
      if (
        this.state.permissions?.screenRecording === 'denied' ||
        this.state.permissions?.screenRecording === 'restricted'
      ) {
        this.setState({
          error: 'Screen Recording access is disabled in System Settings.',
          recoveryAction: 'open-screen-settings',
        });
      } else {
        await this.requestPermissions(false);
      }
      return;
    }

    if (this.state.recordingOptions.microphone && this.state.permissions.microphone !== 'granted') {
      if (
        this.state.permissions.microphone === 'denied' ||
        this.state.permissions.microphone === 'restricted'
      ) {
        this.setState({
          error: 'Microphone access is disabled. Enable it or turn off microphone recording.',
          recoveryAction: 'open-microphone-settings',
        });
      } else {
        await this.requestPermissions(true);
      }
      return;
    }

    this.setState({ operation: 'starting', error: null, notice: null });

    try {
      const response = await this.api.startRecording({
        source,
        region: this.state.recordingOptions.region,
        profileId: this.state.recordingOptions.profileId,
        resolution: this.state.recordingOptions.resolution,
        frameRate: this.state.recordingOptions.frameRate,
        audio: {
          systemAudio: this.state.recordingOptions.systemAudio,
          microphone: this.state.recordingOptions.microphone,
          microphoneDeviceId: null,
        },
        showsCursor: this.state.recordingOptions.showsCursor,
        showsMouseClicks: this.state.recordingOptions.showsMouseClicks,
      });

      this.setState({
        activeSession: response.session,
        recordingState: response.session.state,
        progress: {
          durationMs: response.session.statistics.durationMs,
          encodedBytes: response.session.statistics.encodedBytes,
          droppedFrames: response.session.statistics.droppedFrames,
        },
        diskSpace: null,
        operation: 'idle',
      });
    } catch (error: unknown) {
      const code = errorCode(error);
      const normalizedMessage = errorMessage(error, '').toLocaleLowerCase();
      const microphoneFailure = normalizedMessage.includes('microphone');
      const restartFailure = normalizedMessage.includes('restart');
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Recording could not start.'),
        recoveryAction:
          code === 'INVALID_CAPTURE_SOURCE'
            ? 'refresh-sources'
            : code === 'SCREEN_RECORDING_PERMISSION_REQUIRED'
              ? restartFailure
                ? 'restart-application'
                : 'open-screen-settings'
              : code === 'UNSUPPORTED_AUDIO' || microphoneFailure
                ? 'open-microphone-settings'
                : 'refresh-sources',
      });
    }
  }

  public async pauseRecording(): Promise<void> {
    const sessionId = this.state.activeSession?.id;
    if (sessionId === undefined) return;

    this.setState({ operation: 'pausing', error: null });
    try {
      await this.api.pauseRecording(sessionId);
      this.setState({ operation: 'idle' });
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Recording could not be paused.'),
      });
    }
  }

  public async resumeRecording(): Promise<void> {
    const sessionId = this.state.activeSession?.id;
    if (sessionId === undefined) return;

    this.setState({ operation: 'resuming', error: null });
    try {
      await this.api.resumeRecording(sessionId);
      this.setState({ operation: 'idle' });
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Recording could not be resumed.'),
      });
    }
  }

  public async stopRecording(): Promise<void> {
    const sessionId = this.state.activeSession?.id;
    if (sessionId === undefined) return;

    this.setState({ operation: 'stopping', error: null });
    try {
      const artifact = await this.api.stopRecording(sessionId);
      this.setState({
        activeSession: null,
        recordingState: 'completed',
        progress: {
          durationMs: artifact.durationMs,
          encodedBytes: artifact.fileSizeBytes,
          droppedFrames: 0,
        },
        recordings: withRecording(this.state.recordings, metadataFromArtifact(artifact)),
        operation: 'idle',
        notice: 'Recording saved to your library.',
      });
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Recording could not be finalized.'),
      });
    }
  }

  public async updatePreferences(patch: AppPreferencesPatchDto): Promise<void> {
    this.setState({ operation: 'saving-preferences', error: null });

    try {
      const preferences = await this.api.updatePreferences(patch);
      this.setState({
        preferences,
        recordingOptions: this.optionsFromPreferences(preferences, this.state.recordingOptions),
        recoveryAction: this.permissionRecoveryAction(
          this.state.permissions,
          preferences.microphoneEnabled,
        ),
        operation: 'idle',
      });
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Preferences could not be saved.'),
      });
    }
  }

  private sourceState(
    sources: readonly CaptureSourceDto[],
  ): Pick<RendererState, 'sources' | 'selectedSourceId' | 'recordingOptions'> {
    const selectedSourceId = sources.some(
      (source) => source.id === this.state.selectedSourceId && source.isAvailable,
    )
      ? this.state.selectedSourceId
      : (sources.find((source) => source.isAvailable)?.id ?? null);
    const selectedSource = sources.find((source) => source.id === selectedSourceId);
    return {
      sources,
      selectedSourceId,
      recordingOptions: {
        ...this.state.recordingOptions,
        region: selectedSource?.kind === 'display' ? this.state.recordingOptions.region : null,
      },
    };
  }

  private optionsFromPreferences(
    preferences: AppPreferencesDto,
    current: RecordingOptions = this.state.recordingOptions,
  ): RecordingOptions {
    return {
      ...current,
      profileId: preferences.defaultProfileId,
      resolution: preferences.defaultResolution,
      frameRate: preferences.defaultFrameRate,
      systemAudio: preferences.systemAudioEnabled,
      microphone: preferences.microphoneEnabled,
    };
  }

  private permissionRecoveryAction(
    permissions: CapturePermissionsDto | null,
    microphoneRequested: boolean,
  ): RecoveryAction | null {
    if (permissions === null) return null;
    if (permissions.screenRecordingRequiresRestart) return 'restart-application';
    if (permissions.screenRecording === 'denied' || permissions.screenRecording === 'restricted') {
      return 'open-screen-settings';
    }
    if (
      microphoneRequested &&
      (permissions.microphone === 'denied' || permissions.microphone === 'restricted')
    ) {
      return 'open-microphone-settings';
    }
    return null;
  }

  private handleEvent(event: IpcEvent): void {
    switch (event.type) {
      case 'recording.state-changed':
        this.setState({ recordingState: event.state });
        return;
      case 'recording.progress':
        if (this.state.activeSession?.id === event.sessionId) {
          this.setState({
            progress: {
              ...this.state.progress,
              durationMs: event.durationMs,
              encodedBytes: event.encodedBytes,
            },
          });
        }
        return;
      case 'recording.dropped-frames':
        if (this.state.activeSession?.id === event.sessionId) {
          this.setState({
            progress: { ...this.state.progress, droppedFrames: event.droppedFrames },
            notice: `${event.droppedFrames} frames were dropped while recording.`,
          });
        }
        return;
      case 'recording.warning':
        this.setState({ notice: event.message });
        return;
      case 'recording.disk-space-warning':
        this.setState({
          diskSpace: {
            availableBytes: event.availableBytes,
            estimatedRequiredBytes: event.estimatedRequiredBytes,
          },
          notice: 'Available disk space is getting low.',
        });
        return;
      case 'recording.completed':
        this.setState({
          activeSession: null,
          recordingState: 'completed',
          recordings: withRecording(this.state.recordings, metadataFromArtifact(event.artifact)),
          progress: {
            durationMs: event.artifact.durationMs,
            encodedBytes: event.artifact.fileSizeBytes,
            droppedFrames: this.state.progress.droppedFrames,
          },
          operation: 'idle',
          notice: 'Recording saved to your library.',
        });
        return;
      case 'recording.failed':
        this.setState({
          activeSession: null,
          recordingState: 'failed',
          operation: 'idle',
          error: event.reason,
        });
        return;
      case 'permissions.changed':
        this.setState({
          permissions: {
            screenRecording: event.screenRecording as CapturePermissionsDto['screenRecording'],
            microphone: event.microphone as CapturePermissionsDto['microphone'],
            screenRecordingRequiresRestart: event.screenRecordingRequiresRestart,
          },
        });
        return;
      case 'native-service.failed':
        this.setState({ error: event.message, operation: 'idle' });
        return;
    }
  }

  private setState(patch: Partial<RendererState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export function useRendererSelector<T>(
  store: RendererStore,
  selector: (state: RendererState) => T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

let sharedRendererStore: RendererStore | undefined;

export function getRendererStore(): RendererStore {
  if (sharedRendererStore === undefined) {
    if (typeof window === 'undefined' || window.screenRecorder === undefined) {
      throw new Error('The screen recorder API is unavailable outside the Electron renderer.');
    }
    sharedRendererStore = new RendererStore(window.screenRecorder);
  }
  return sharedRendererStore;
}
