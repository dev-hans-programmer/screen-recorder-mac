import { describe, expect, it } from 'vitest';

import {
  DomainError,
  RecordingSession,
  assertCaptureRegionFitsWithin,
  captureRegionFitsWithin,
  createCaptureRegion,
  createCaptureSource,
  createCaptureSourceSelection,
  createDurationMs,
  createRecordingArtifact,
  createRecordingEditPlan,
  createRecordingFilePath,
  createPixelDimensions,
  createFrameRate,
  getRecordingProfile,
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

  it('validates pixel dimensions, frame rates, and recording profiles', () => {
    expect(createPixelDimensions(3840, 2160)).toEqual({ width: 3840, height: 2160 });
    expect(createFrameRate(60)).toBe(60);
    expect(getRecordingProfile('master')).toMatchObject({ codec: 'prores422', container: 'mov' });
    expect(() => createPixelDimensions(1920.5, 1080)).toThrowError(DomainError);
    expect(() => createFrameRate(120)).toThrowError(DomainError);
    expect(() => getRecordingProfile('unknown' as 'compatible')).toThrowError(DomainError);
  });

  it('checks local region bounds before coordinate conversion reaches native capture', () => {
    const sourceBounds = createPixelDimensions(2560, 1440);
    const edgeAligned = createCaptureRegion(1920, 1080, 640, 360);
    const overflow = createCaptureRegion(1921, 1080, 640, 360);

    expect(captureRegionFitsWithin(edgeAligned, sourceBounds)).toBe(true);
    expect(captureRegionFitsWithin(overflow, sourceBounds)).toBe(false);
    expect(captureRegionFitsWithin(createCaptureRegion(-1, 0, 100, 100), sourceBounds)).toBe(false);
    expect(() => assertCaptureRegionFitsWithin(overflow, sourceBounds)).toThrowError(DomainError);
    expect(scaleCaptureRegion(createCaptureRegion(5, 7, 101, 51), 2)).toEqual({
      x: 10,
      y: 14,
      width: 202,
      height: 102,
    });
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
      codec: 'h264',
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

  it('supports failure from an in-progress state and prevents terminal mutations', () => {
    const session = RecordingSession.create('session-failure', 100);
    session.prepare(110);
    session.start(120, 'engine-failure');
    session.fail(130, 'Native helper exited.');

    expect(session.toSnapshot()).toMatchObject({
      state: 'failed',
      failureReason: 'Native helper exited.',
    });
    expect(() => session.pause(140)).toThrowError(DomainError);
    expect(() => session.fail(140, 'again')).toThrowError(DomainError);
    expect(() =>
      session.updateStatistics({
        durationMs: createDurationMs(1),
        capturedFrames: 1,
        encodedFrames: 1,
        droppedFrames: 0,
        encodedBytes: 1,
      }),
    ).toThrowError(DomainError);
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

describe('recording edit plan', () => {
  it('validates and merges overlapping mute ranges without mutating the source', () => {
    const plan = createRecordingEditPlan(
      {
        recordingId: 'recording-1',
        title: '  Product demo edit  ',
        trimStartMs: 1_000,
        trimEndMs: 9_000,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        rotation: 90,
        mutedRanges: [
          { startMs: 4_000, endMs: 5_000 },
          { startMs: 2_000, endMs: 4_500 },
        ],
        posterTimeMs: 3_000,
      },
      10_000,
    );

    expect(plan).toMatchObject({ title: 'Product demo edit', rotation: 90 });
    expect(plan.mutedRanges).toEqual([{ startMs: 2_000, endMs: 5_000 }]);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('rejects edits outside source, crop, and timeline bounds', () => {
    const valid = {
      recordingId: 'recording-1',
      title: 'Edit',
      trimStartMs: 0,
      trimEndMs: 5_000,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      rotation: 0 as const,
      mutedRanges: [],
      posterTimeMs: 0,
    };

    expect(() => createRecordingEditPlan({ ...valid, trimEndMs: 5_001 }, 5_000)).toThrowError(
      DomainError,
    );
    expect(() =>
      createRecordingEditPlan({ ...valid, crop: { x: 0.5, y: 0, width: 0.6, height: 1 } }, 5_000),
    ).toThrowError(DomainError);
    expect(() =>
      createRecordingEditPlan({ ...valid, mutedRanges: [{ startMs: 4_000, endMs: 5_100 }] }, 5_000),
    ).toThrowError(DomainError);
  });
});
