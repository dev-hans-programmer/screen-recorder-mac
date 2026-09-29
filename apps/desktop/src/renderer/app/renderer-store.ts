import { useSyncExternalStore } from 'react';

import type {
  AppPreferencesDto,
  AppPreferencesPatchDto,
  CaptureRegionDto,
  CapturePermissionsDto,
  CaptureSourceDto,
  IpcEvent,
  RecordingArtifactDto,
  RecordingSessionSnapshotDto,
} from '@screen-recorder/contracts';

import type { ScreenRecorderApi } from '../../shared/screen-recorder-api';

export type AppScreen = 'recorder' | 'library' | 'settings';
export type Operation =
  | 'idle'
  | 'initializing'
  | 'requesting-permission'
  | 'starting'
  | 'pausing'
  | 'resuming'
  | 'stopping'
  | 'saving-preferences';

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
  readonly recordings: readonly RecordingArtifactDto[];
  readonly recordingOptions: RecordingOptions;
  readonly activeSession: RecordingSessionSnapshotDto | null;
  readonly recordingState: RecordingSessionSnapshotDto['state'] | 'idle';
  readonly progress: RecordingProgress;
  readonly diskSpace: DiskSpaceStatus | null;
  readonly operation: Operation;
  readonly error: string | null;
  readonly notice: string | null;
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
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function withArtifact(
  artifacts: readonly RecordingArtifactDto[],
  artifact: RecordingArtifactDto,
): readonly RecordingArtifactDto[] {
  return [artifact, ...artifacts.filter((candidate) => candidate.id !== artifact.id)];
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
          ...(permissions.status === 'fulfilled' ? { permissions: permissions.value } : {}),
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
  }

  public clearFeedback(): void {
    this.setState({ error: null, notice: null });
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
      this.setState({ ...this.sourceState(sources), error: null });
    } catch (error: unknown) {
      this.setState({ error: errorMessage(error, 'Capture sources could not be refreshed.') });
    }
  }

  public setRecordingOptions(patch: Partial<RecordingOptions>): void {
    this.setState({ recordingOptions: { ...this.state.recordingOptions, ...patch }, error: null });
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

  public async requestPermissions(): Promise<void> {
    this.setState({ operation: 'requesting-permission', error: null });

    try {
      const permissions = await this.api.requestCapturePermissions({
        microphone: this.state.recordingOptions.microphone,
      });
      this.setState({ permissions, operation: 'idle' });
    } catch (error: unknown) {
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Permission request failed.'),
      });
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

    if (
      this.state.permissions?.screenRecording !== 'granted' ||
      (this.state.recordingOptions.microphone && this.state.permissions.microphone !== 'granted')
    ) {
      await this.requestPermissions();
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
      this.setState({
        operation: 'idle',
        error: errorMessage(error, 'Recording could not start.'),
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
        recordings: withArtifact(this.state.recordings, artifact),
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
          recordings: withArtifact(this.state.recordings, event.artifact),
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
