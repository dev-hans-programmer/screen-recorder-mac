import { describe, expect, it, vi } from 'vitest';

import type {
  AppPreferencesDto,
  CapturePermissionsDto,
  CaptureSourceDto,
  IpcEvent,
  RecordingArtifactDto,
  RecordingMetadataDto,
  RecordingSessionSnapshotDto,
} from '@screen-recorder/contracts';

import type { ScreenRecorderApi } from '../src/shared/screen-recorder-api';
import { RendererStore } from '../src/renderer/app/renderer-store';

const source: CaptureSourceDto = {
  id: 'display:main',
  kind: 'display',
  name: 'Built-in Display',
  dimensions: { width: 2560, height: 1600 },
  scaleFactor: 2,
  isAvailable: true,
};

const preferences: AppPreferencesDto = {
  outputDirectory: '/tmp/Screen Recorder',
  defaultProfileId: 'balanced',
  defaultResolution: 'source',
  defaultFrameRate: 60,
  systemAudioEnabled: true,
  microphoneEnabled: false,
  theme: 'system',
  onboardingCompleted: true,
  shortcuts: {
    startStop: 'CommandOrControl+Shift+R',
    pauseResume: 'CommandOrControl+Shift+P',
  },
};

const permissions: CapturePermissionsDto = {
  screenRecording: 'granted',
  microphone: 'not-determined',
  screenRecordingRequiresRestart: false,
};

const artifact: RecordingArtifactDto = {
  id: 'recording-1',
  filePath: '/tmp/Screen Recorder/recording-1.mp4',
  title: 'Built-in Display · 2026-09-30',
  createdAt: 1_000,
  durationMs: 1_500,
  width: 2560,
  height: 1600,
  frameRate: 60,
  profileId: 'balanced',
  codec: 'hevc',
  hasSystemAudio: true,
  hasMicrophone: false,
  fileSizeBytes: 1_048_576,
};

const session: RecordingSessionSnapshotDto = {
  id: 'session-1',
  state: 'capturing',
  createdAt: 1_000,
  startedAt: 1_010,
  pausedAt: null,
  pausedDurationMs: 0,
  stoppedAt: null,
  completedAt: null,
  engineHandleId: 'engine-1',
  artifact: null,
  failureReason: null,
  statistics: {
    durationMs: 0,
    capturedFrames: 0,
    encodedFrames: 0,
    droppedFrames: 0,
    encodedBytes: 0,
  },
};

const validation: Awaited<ReturnType<ScreenRecorderApi['validateRecordingRequest']>> = {
  requested: {
    source,
    region: null,
    profileId: 'balanced',
    resolution: 'source',
    frameRate: 60,
    audio: { systemAudio: true, microphone: false, microphoneDeviceId: null },
    showsCursor: true,
    showsMouseClicks: false,
  },
  effective: {
    source,
    region: null,
    profileId: 'balanced',
    resolution: 'source',
    frameRate: 60,
    audio: { systemAudio: true, microphone: false, microphoneDeviceId: null },
    showsCursor: true,
    showsMouseClicks: false,
  },
  outputDimensions: { width: 2560, height: 1600 },
  warnings: [],
};

function createApi() {
  let eventListener: ((event: IpcEvent) => void) | undefined;
  let currentPreferences = preferences;
  const api: ScreenRecorderApi = {
    listCaptureSources: vi.fn(async () => [source]),
    getCapturePermissions: vi.fn(async () => permissions),
    requestCapturePermissions: vi.fn(async () => permissions),
    selectRegion: vi.fn(async () => null),
    submitRegionSelection: vi.fn(),
    cancelRegionSelection: vi.fn(),
    validateRecordingRequest: vi.fn(async () => validation),
    startRecording: vi.fn(async () => ({ session, validation })),
    pauseRecording: vi.fn(async () => undefined),
    resumeRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => artifact),
    listRecordings: vi.fn(async () => []),
    getRecordingThumbnail: vi.fn(async () => null),
    renameRecording: vi.fn(async (_recordingId, title): Promise<RecordingMetadataDto> => ({
      ...artifact,
      title,
      schemaVersion: 1,
      availability: 'available',
      failure: null,
      recovery: null,
    })),
    openRecording: vi.fn(async () => undefined),
    revealRecording: vi.fn(async () => undefined),
    deleteRecording: vi.fn(async () => undefined),
    openRecordingsFolder: vi.fn(async () => undefined),
    openPermissionSettings: vi.fn(async () => undefined),
    relaunchApplication: vi.fn(async () => undefined),
    getPreferences: vi.fn(async () => currentPreferences),
    updatePreferences: vi.fn(async (patch) => {
      currentPreferences = {
        ...currentPreferences,
        ...patch,
        shortcuts: { ...currentPreferences.shortcuts, ...patch.shortcuts },
      };
      return currentPreferences;
    }),
    onEvent: vi.fn((listener: (event: IpcEvent) => void) => {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    }),
    onShortcut: vi.fn(() => () => undefined),
  };

  return {
    api,
    emit(event: IpcEvent) {
      eventListener?.(event);
    },
  };
}

describe('RendererStore', () => {
  it('initializes the workspace and selects the first available source', async () => {
    const fixture = createApi();
    const store = new RendererStore(fixture.api);

    await store.initialize();

    expect(store.getState().initialized).toBe(true);
    expect(store.getState().selectedSourceId).toBe(source.id);
    expect(store.getState().preferences?.defaultProfileId).toBe('balanced');
    expect(store.getState().permissions?.screenRecording).toBe('granted');
  });

  it('updates only recording metadata when progress events arrive', async () => {
    const fixture = createApi();
    const store = new RendererStore(fixture.api);
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    await store.initialize();
    await store.startRecording();
    const notificationsBeforeProgress = notifications;

    fixture.emit({
      protocolVersion: 1,
      eventId: 'event-progress',
      version: 1,
      type: 'recording.progress',
      sessionId: session.id,
      durationMs: 4_200,
      encodedBytes: 4_000_000,
      occurredAt: 5_000,
    });

    expect(store.getState().progress).toEqual({
      durationMs: 4_200,
      encodedBytes: 4_000_000,
      droppedFrames: 0,
    });
    expect(notifications).toBeGreaterThan(notificationsBeforeProgress);
  });

  it('completes the pause and stop flow and adds the artifact to the library', async () => {
    const fixture = createApi();
    const store = new RendererStore(fixture.api);

    await store.initialize();
    await store.startRecording();
    await store.pauseRecording();
    await store.resumeRecording();
    await store.stopRecording();

    expect(fixture.api.pauseRecording).toHaveBeenCalledWith(session.id);
    expect(fixture.api.resumeRecording).toHaveBeenCalledWith(session.id);
    expect(fixture.api.stopRecording).toHaveBeenCalledWith(session.id);
    expect(store.getState().activeSession).toBeNull();
    expect(store.getState().recordings[0]).toEqual({
      ...artifact,
      schemaVersion: 1,
      availability: 'available',
      failure: null,
      recovery: null,
    });
    expect(store.getState().recordingState).toBe('completed');
  });

  it('keeps region and capture controls in the native recording request', async () => {
    const fixture = createApi();
    const store = new RendererStore(fixture.api);

    await store.initialize();
    store.setRecordingOptions({
      region: { x: 40, y: 30, width: 1280, height: 720 },
      profileId: 'compatible',
      resolution: '1080p',
      frameRate: 30,
      systemAudio: false,
      microphone: true,
      showsCursor: false,
      showsMouseClicks: true,
    });
    vi.mocked(fixture.api.requestCapturePermissions).mockResolvedValue({
      screenRecording: 'granted',
      microphone: 'granted',
      screenRecordingRequiresRestart: false,
    });
    await store.startRecording();
    await store.startRecording();

    expect(fixture.api.startRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        region: { x: 40, y: 30, width: 1280, height: 720 },
        profileId: 'compatible',
        resolution: '1080p',
        frameRate: 30,
        audio: { systemAudio: false, microphone: true, microphoneDeviceId: null },
        showsCursor: false,
        showsMouseClicks: true,
      }),
    );
  });

  it('clears a selected source when a refresh reports that it disappeared', async () => {
    const fixture = createApi();
    const store = new RendererStore(fixture.api);

    await store.initialize();
    vi.mocked(fixture.api.listCaptureSources).mockResolvedValueOnce([]);
    await store.refreshSources();

    expect(store.getState().sources).toEqual([]);
    expect(store.getState().selectedSourceId).toBeNull();
  });

  it('persists onboarding completion through the preferences boundary', async () => {
    const fixture = createApi();
    const store = new RendererStore(fixture.api);

    await store.initialize();
    await store.completeOnboarding();

    expect(fixture.api.updatePreferences).toHaveBeenCalledWith({ onboardingCompleted: true });
    expect(store.getState().preferences?.onboardingCompleted).toBe(true);
  });

  it('blocks capture and offers an app restart when macOS requires one', async () => {
    const fixture = createApi();
    vi.mocked(fixture.api.getCapturePermissions).mockResolvedValue({
      ...permissions,
      screenRecordingRequiresRestart: true,
    });
    const store = new RendererStore(fixture.api);

    await store.initialize();
    await store.startRecording();
    store.runRecoveryAction();

    expect(fixture.api.startRecording).not.toHaveBeenCalled();
    expect(store.getState().recoveryAction).toBe('restart-application');
    await vi.waitFor(() => expect(fixture.api.relaunchApplication).toHaveBeenCalledOnce());
  });

  it('detects revoked screen access and opens its System Settings pane', async () => {
    const fixture = createApi();
    const store = new RendererStore(fixture.api);
    await store.initialize();
    vi.mocked(fixture.api.getCapturePermissions).mockResolvedValueOnce({
      screenRecording: 'denied',
      microphone: 'not-determined',
      screenRecordingRequiresRestart: false,
    });

    await store.refreshPermissions();
    store.runRecoveryAction();

    expect(store.getState().error).toContain('revoked');
    expect(store.getState().recoveryAction).toBe('open-screen-settings');
    await vi.waitFor(() =>
      expect(fixture.api.openPermissionSettings).toHaveBeenCalledWith('screen-recording'),
    );
  });

  it('offers to refresh sources after a selected source becomes invalid', async () => {
    const fixture = createApi();
    vi.mocked(fixture.api.startRecording).mockRejectedValueOnce(
      Object.assign(new Error('The selected window is no longer available.'), {
        code: 'INVALID_CAPTURE_SOURCE',
      }),
    );
    const store = new RendererStore(fixture.api);
    await store.initialize();

    await store.startRecording();
    store.runRecoveryAction();

    expect(store.getState().recoveryAction).toBe('refresh-sources');
    await vi.waitFor(() => expect(fixture.api.listCaptureSources).toHaveBeenCalledTimes(2));
  });

  it('renames and deletes recordings through purpose-built library actions', async () => {
    const fixture = createApi();
    const store = new RendererStore(fixture.api);
    await store.initialize();
    fixture.emit({
      protocolVersion: 1,
      eventId: 'recording-completed',
      version: 1,
      type: 'recording.completed',
      sessionId: 'session-1',
      artifact,
      occurredAt: 2_500,
    });

    await store.renameRecording(artifact.id, 'Renamed capture');
    expect(fixture.api.renameRecording).toHaveBeenCalledWith(artifact.id, 'Renamed capture');
    expect(store.getState().recordings[0]?.title).toBe('Renamed capture');

    await store.deleteRecording(artifact.id);
    expect(fixture.api.deleteRecording).toHaveBeenCalledWith(artifact.id);
    expect(store.getState().recordings).toEqual([]);
  });
});
