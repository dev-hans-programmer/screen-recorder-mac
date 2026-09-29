import { describe, expect, it } from 'vitest';

import {
  DomainError,
  RecordingSession,
  createCaptureRegion,
  createCaptureSource,
  createCaptureSourceSelection,
  createDurationMs,
  createRecordingArtifact,
  createRecordingFilePath,
  defaultAppPreferences,
  scaleCaptureRegion,
  updateAppPreferences,
} from '@screen-recorder/domain';

describe('capture domain models', () => {
  it('validates source dimensions and scales a selected region', () => {
    const source = createCaptureSource({
      id: 'display-main',
      kind: 'display',
      name: 'Main Display',
      dimensions: { width: 3840, height: 2160 },
      scaleFactor: 2,
    });
    const region = createCaptureRegion(10, 20, 100, 50);
    const selection = createCaptureSourceSelection(source.id, region);

    expect(source.dimensions).toEqual({ width: 3840, height: 2160 });
    expect(scaleCaptureRegion(selection.region!, 2)).toEqual({
      x: 20,
      y: 40,
      width: 200,
      height: 100,
    });
  });

  it('rejects invalid capture values with typed domain errors', () => {
    expect(() => createCaptureRegion(0, 0, 1, 100)).toThrowError(DomainError);
    expect(() => createCaptureSourceSelection('')).toThrowError(DomainError);
    expect(() => createDurationMs(-1)).toThrowError(DomainError);
  });
});

describe('recording session aggregate', () => {
  it('enforces the recording lifecycle and accounts for paused time', () => {
    const session = RecordingSession.create('session-1', 100);
    session.prepare(110);
    session.start(120, 'engine-1');
    session.updateStatistics({
      durationMs: createDurationMs(80),
      capturedFrames: 5,
      encodedFrames: 4,
      droppedFrames: 1,
      encodedBytes: 512,
    });
    session.pause(200);
    session.resume(500);
    session.stop(600);

    const artifact = createRecordingArtifact({
      id: 'artifact-1',
      filePath: createRecordingFilePath('/tmp/recording.mp4'),
      title: 'Recording',
      createdAt: 120,
      durationMs: createDurationMs(400),
      width: 1920,
      height: 1080,
      frameRate: 60,
      profileId: 'compatible',
      hasSystemAudio: false,
      hasMicrophone: false,
      fileSizeBytes: 1024,
    });

    session.complete(700, artifact);

    expect(session.toSnapshot()).toMatchObject({
      state: 'completed',
      pausedDurationMs: 300,
      statistics: expect.objectContaining({ droppedFrames: 1 }),
      artifact,
    });
  });

  it('rejects illegal transitions', () => {
    const session = RecordingSession.create('session-2', 100);

    try {
      session.start(110, 'engine-2');
      throw new Error('Expected the transition to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('INVALID_RECORDING_STATE');
    }
  });
});

describe('preferences domain model', () => {
  it('updates nested shortcuts without losing other defaults', () => {
    const updated = updateAppPreferences(defaultAppPreferences, {
      outputDirectory: '/Users/tester/Movies/Screen Recorder',
      shortcuts: { pauseResume: 'CommandOrControl+Shift+K' },
    });

    expect(updated.outputDirectory).toContain('Screen Recorder');
    expect(updated.shortcuts).toEqual({
      startStop: 'CommandOrControl+Shift+R',
      pauseResume: 'CommandOrControl+Shift+K',
    });
  });
});
