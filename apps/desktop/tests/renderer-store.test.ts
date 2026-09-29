import { describe, expect, it, vi } from 'vitest';

import type {
  AppPreferencesDto,
  CapturePermissionsDto,
  CaptureSourceDto,
  IpcEvent,
  RecordingArtifactDto,
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
  shortcuts: {
    startStop: 'CommandOrControl+Shift+R',
    pauseResume: 'CommandOrControl+Shift+P',
  },
};

const permissions: CapturePermissionsDto = {
  screenRecording: 'granted',
  microphone: 'not-determined',
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
    validateRecordingRequest: vi.fn(async () => validation),
    startRecording: vi.fn(async () => ({ session, validation })),
    pauseRecording: vi.fn(async () => undefined),
    resumeRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => artifact),
    listRecordings: vi.fn(async () => []),
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
    expect(store.getState().recordings[0]).toEqual(artifact);
    expect(store.getState().recordingState).toBe('completed');
  });
});
