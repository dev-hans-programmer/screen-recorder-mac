import { describe, expect, it } from 'vitest';

import {
  PauseRecordingUseCase,
  ResumeRecordingUseCase,
  StartRecordingUseCase,
  StopRecordingUseCase,
  UpdatePreferencesUseCase,
  ValidateRecordingRequestUseCase,
  type ApplicationEvent,
  type CaptureCapabilities,
  type CapturePort,
  type Clock,
  type IdGenerator,
  type RecordingEnginePort,
  type RecordingCatalogRepository,
  type RecordingSessionRepository,
  type StartRecordingDependencies,
} from '@screen-recorder/application';
import {
  DomainError,
  RecordingSession,
  createCaptureSource,
  createDurationMs,
  createRecordingArtifact,
  createRecordingFilePath,
  createRecordingRequest,
  defaultAppPreferences,
  type AppPreferences,
  type CapturePermissions,
  type CaptureSource,
  type RecordingArtifact,
  type RecordingMetadata,
  type RecordingRequest,
} from '@screen-recorder/domain';

const display = createCaptureSource({
  id: 'display-main',
  kind: 'display',
  name: 'Main Display',
  dimensions: { width: 3840, height: 2160 },
});

const capabilities: CaptureCapabilities = {
  maxOutputDimensions: { width: 3840, height: 2160 },
  supportedProfileIds: ['compatible', 'balanced'],
  supportedFrameRates: [30],
  supportsSystemAudio: false,
  supportsMicrophone: true,
};

function makeRequest(overrides: Partial<RecordingRequest> = {}): RecordingRequest {
  return createRecordingRequest({
    source: display,
    region: undefined,
    profileId: 'master',
    resolution: '4k',
    frameRate: 60,
    audio: {
      systemAudio: true,
      microphone: false,
    },
    showsCursor: true,
    showsMouseClicks: false,
    ...overrides,
  });
}

class FakeCapturePort implements CapturePort {
  public permissions: CapturePermissions = {
    screenRecording: 'granted',
    microphone: 'granted',
  };

  public listSources(): Promise<readonly CaptureSource[]> {
    return Promise.resolve([display]);
  }

  public getPermissions(): Promise<CapturePermissions> {
    return Promise.resolve(this.permissions);
  }

  public requestPermissions(): Promise<CapturePermissions> {
    return Promise.resolve(this.permissions);
  }

  public getCapabilities(): Promise<CaptureCapabilities> {
    return Promise.resolve(capabilities);
  }
}

class FakeSessionRepository implements RecordingSessionRepository {
  public readonly sessions = new Map<string, RecordingSession>();

  public findActive(): Promise<RecordingSession | undefined> {
    const active = [...this.sessions.values()].find((session) =>
      ['preparing', 'capturing', 'paused', 'stopping'].includes(session.state),
    );

    return Promise.resolve(active);
  }

  public findById(id: string): Promise<RecordingSession | undefined> {
    return Promise.resolve(this.sessions.get(id));
  }

  public save(session: RecordingSession): Promise<void> {
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }
}

class FakeCatalog implements RecordingCatalogRepository {
  public readonly recordings = new Map<string, RecordingMetadata>();

  public list(): Promise<readonly RecordingMetadata[]> {
    return Promise.resolve([...this.recordings.values()]);
  }

  public findById(id: string): Promise<RecordingMetadata | undefined> {
    return Promise.resolve(this.recordings.get(id));
  }

  public save(recording: RecordingMetadata): Promise<void> {
    this.recordings.set(recording.id, recording);
    return Promise.resolve();
  }

  public remove(id: string): Promise<void> {
    this.recordings.delete(id);
    return Promise.resolve();
  }
}

class FakeEngine implements RecordingEnginePort {
  public readonly started: string[] = [];
  public readonly paused: string[] = [];
  public readonly resumed: string[] = [];
  public readonly stopped: string[] = [];

  public async start(_request: never, sessionId: string): Promise<{ id: string }> {
    this.started.push(sessionId);
    return { id: 'engine-1' };
  }

  public pause(handleId: string): Promise<void> {
    this.paused.push(handleId);
    return Promise.resolve();
  }

  public resume(handleId: string): Promise<void> {
    this.resumed.push(handleId);
    return Promise.resolve();
  }

  public stop(handleId: string): Promise<RecordingArtifact> {
    this.stopped.push(handleId);
    return Promise.resolve(
      createRecordingArtifact({
        id: 'artifact-1',
        filePath: createRecordingFilePath('/tmp/recording.mp4'),
        title: 'Recording',
        createdAt: 100,
        durationMs: createDurationMs(500),
        width: 3840,
        height: 2160,
        frameRate: 30,
        profileId: 'balanced',
        codec: 'hevc',
        hasSystemAudio: false,
        hasMicrophone: false,
        fileSizeBytes: 2048,
      }),
    );
  }
}

class FakeClock implements Clock {
  private current = 100;

  public now(): number {
    this.current += 10;
    return this.current;
  }
}

class FakeIds implements IdGenerator {
  public next(): string {
    return 'session-1';
  }
}

class FakeEvents {
  public readonly values: ApplicationEvent[] = [];

  public publish(event: ApplicationEvent): void {
    this.values.push(event);
  }
}

function makeStartDependencies(
  capture: FakeCapturePort,
  sessions: FakeSessionRepository,
  engine: FakeEngine,
  events: FakeEvents,
): StartRecordingDependencies {
  return {
    capture,
    sessions,
    engine,
    clock: new FakeClock(),
    ids: new FakeIds(),
    events,
  };
}

describe('recording application use cases', () => {
  it('validates requested quality against native capabilities with warnings', async () => {
    const result = await new ValidateRecordingRequestUseCase(new FakeCapturePort()).execute(
      makeRequest(),
    );

    expect(result.effective.profileId).toBe('balanced');
    expect(result.effective.frameRate).toBe(30);
    expect(result.effective.audio.systemAudio).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'PROFILE_FALLBACK',
      'FRAME_RATE_FALLBACK',
      'SYSTEM_AUDIO_DISABLED',
    ]);
  });

  it('coordinates start, pause, resume, and stop without crossing raw media data', async () => {
    const capture = new FakeCapturePort();
    const sessions = new FakeSessionRepository();
    const engine = new FakeEngine();
    const events = new FakeEvents();
    const dependencies = makeStartDependencies(capture, sessions, engine, events);
    const started = await new StartRecordingUseCase(dependencies).execute(makeRequest());

    await new PauseRecordingUseCase(sessions, engine, dependencies.clock, events).execute(
      started.session.id,
    );
    await new ResumeRecordingUseCase(sessions, engine, dependencies.clock, events).execute(
      started.session.id,
    );
    const catalog = new FakeCatalog();
    const artifact = await new StopRecordingUseCase(
      sessions,
      catalog,
      engine,
      dependencies.clock,
      events,
    ).execute(started.session.id);

    expect(started.session.state).toBe('capturing');
    expect(sessions.sessions.get(started.session.id)?.state).toBe('completed');
    expect(artifact.filePath).toBe('/tmp/recording.mp4');
    expect(engine.started).toEqual(['session-1']);
    expect(engine.paused).toEqual(['engine-1']);
    expect(engine.resumed).toEqual(['engine-1']);
    expect(engine.stopped).toEqual(['engine-1']);
    expect(catalog.recordings.get(artifact.id)).toMatchObject({ schemaVersion: 1, codec: 'hevc' });
    expect(events.values.every((event) => event.version === 1)).toBe(true);
    expect(events.values.some((event) => event.type === 'recording.completed')).toBe(true);
  });

  it('fails early when screen recording permission is missing', async () => {
    const capture = new FakeCapturePort();
    capture.permissions = { screenRecording: 'denied', microphone: 'granted' };
    const dependencies = makeStartDependencies(
      capture,
      new FakeSessionRepository(),
      new FakeEngine(),
      new FakeEvents(),
    );

    try {
      await new StartRecordingUseCase(dependencies).execute(makeRequest());
      throw new Error('Expected permission validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('SCREEN_RECORDING_PERMISSION_REQUIRED');
    }
  });
});

describe('preference application use case', () => {
  it('persists an updated preference snapshot', async () => {
    let current: AppPreferences = defaultAppPreferences;
    const preferences = {
      get: () => Promise.resolve(current),
      save: (updated: AppPreferences) => {
        current = updated;
        return Promise.resolve();
      },
    };

    const result = await new UpdatePreferencesUseCase(preferences).execute({
      defaultFrameRate: 30,
    });

    expect(result.defaultFrameRate).toBe(30);
    expect(current.defaultFrameRate).toBe(30);
  });
});
