import { describe, expect, it, vi } from 'vitest';

import { createCaptureSource, createRecordingRequest, DomainError } from '@screen-recorder/domain';
import type { ApplicationEvent } from '@screen-recorder/application';

import { NativeRecordingEngine } from '../src/main/infrastructure/native/native-capture-adapter';
import { resolveCaptureServicePath } from '../src/main/infrastructure/native/native-service-path';
import { NativeServiceSupervisor } from '../src/main/infrastructure/native/native-service-supervisor';
import {
  mapNativeSource,
  parseNativeCapabilities,
  parseNativeEditedRecordingResult,
  parseNativePermissions,
  parseNativeSources,
  toCaptureCapabilities,
  toNativeDomainError,
} from '../src/main/infrastructure/native/native-mappers';
import { NativeServiceClientError } from '../src/main/infrastructure/native/capture-service-client';

describe('native bridge infrastructure', () => {
  it('resolves a packaged helper before development build candidates', () => {
    const resolved = resolveCaptureServicePath({
      isPackaged: true,
      resourcesPath: '/App/Contents/Resources',
      workingDirectory: '/workspace',
      moduleDirectory: '/workspace/apps/desktop/.vite/build',
      architecture: 'arm64',
      platform: 'darwin',
      exists: (filePath) => filePath === '/App/Contents/Resources/CaptureService',
    });

    expect(resolved).toBe('/App/Contents/Resources/CaptureService');
  });

  it('maps native capabilities and source DTOs into domain-safe values', () => {
    const capabilities = toCaptureCapabilities(
      parseNativeCapabilities({
        maxOutputWidth: 3840,
        maxOutputHeight: 2160,
        supportedProfileIds: ['compatible', 'balanced', 'unknown'],
        supportedFrameRates: [30, 60, 120],
        supportsSystemAudio: true,
        supportsMicrophone: false,
        supportsHDR: true,
        hardwareEncoderProfileIds: ['compatible'],
      }),
    );
    const source = mapNativeSource({
      id: 'display:1',
      kind: 'display',
      name: 'Main Display',
      width: 3840,
      height: 2160,
      scaleFactor: 2,
      isAvailable: true,
    });

    expect(capabilities.supportedProfileIds).toEqual(['compatible', 'balanced']);
    expect(capabilities.supportedFrameRates).toEqual([30, 60]);
    expect(source.dimensions).toEqual({ width: 3840, height: 2160 });
  });

  it('accepts omitted optional metadata from Swift Codable source responses', () => {
    expect(
      parseNativeSources([
        {
          id: 'application:com.example.App',
          kind: 'application',
          name: 'Example App',
          isAvailable: true,
        },
      ]),
    ).toEqual([
      {
        id: 'application:com.example.App',
        kind: 'application',
        name: 'Example App',
        width: null,
        height: null,
        scaleFactor: null,
        isAvailable: true,
      },
    ]);
  });

  it('maps native permission and service failures to domain errors', () => {
    expect(
      parseNativePermissions({
        screenRecording: 'granted',
        microphone: 'not-determined',
        screenRecordingRequiresRestart: false,
      }),
    ).toEqual({
      screenRecording: 'granted',
      microphone: 'not-determined',
      screenRecordingRequiresRestart: false,
    });

    const error = toNativeDomainError(
      new NativeServiceClientError({
        code: 'FILE_FINALIZATION_FAILED',
        message: 'The output file could not be finalized.',
      }),
    );

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('RECORDING_FINALIZATION_FAILURE');
  });

  it('prevents duplicate recording reservations while allowing idle reuse', () => {
    const supervisor = new NativeServiceSupervisor({
      executablePath: '/fake/CaptureService',
      clientVersion: 'test',
    });

    supervisor.reserveRecording('session-1');
    expect(() => supervisor.reserveRecording('session-2')).toThrowError(DomainError);
    supervisor.releaseRecording('session-1');
    expect(() => supervisor.reserveRecording('session-2')).not.toThrow();
  });

  it('keeps capture and editor exports mutually exclusive', () => {
    const supervisor = new NativeServiceSupervisor({
      executablePath: '/fake/CaptureService',
      clientVersion: 'test',
    });

    supervisor.reserveEditor('edit-1');
    expect(() => supervisor.reserveRecording('session-1')).toThrowError(DomainError);
    expect(() => supervisor.reserveEditor('edit-2')).toThrowError(DomainError);
    supervisor.releaseEditor('edit-1');
    expect(() => supervisor.reserveRecording('session-1')).not.toThrow();
  });

  it('validates native edited recording metadata', () => {
    expect(
      parseNativeEditedRecordingResult({
        status: 'completed',
        filePath: '/tmp/edit.mp4',
        thumbnailPath: '/tmp/poster.png',
        profileId: 'balanced',
        codec: 'hevc',
        width: 1080,
        height: 1920,
        frameRate: 60,
        durationMs: 5_000,
        fileSizeBytes: 12_000,
        hasSystemAudio: true,
        hasMicrophone: false,
      }),
    ).toMatchObject({ width: 1080, thumbnailPath: '/tmp/poster.png' });
    expect(() => parseNativeEditedRecordingResult({ status: 'completed' })).toThrowError(
      DomainError,
    );
  });

  it('orchestrates a complete start/pause/resume/stop flow without media IPC', async () => {
    const supervisor = new NativeServiceSupervisor({
      executablePath: '/fake/CaptureService',
      clientVersion: 'test',
    });
    const events: ApplicationEvent[] = [];
    const publisher = { publish: (event: ApplicationEvent) => events.push(event) };
    let now = 1_000;
    const clock = { now: () => now };
    const request = createRecordingRequest({
      source: createCaptureSource({
        id: 'display:1',
        kind: 'display',
        name: 'Main Display',
        dimensions: { width: 960, height: 600 },
      }),
      region: undefined,
      profileId: 'compatible',
      resolution: 'source',
      frameRate: 30,
      audio: { systemAudio: false, microphone: false },
      showsCursor: true,
      showsMouseClicks: false,
    });
    const validated = {
      requested: request,
      effective: request,
      outputDimensions: { width: 960, height: 600 },
      warnings: [],
    } as const;
    const requestSpy = vi.spyOn(supervisor, 'request').mockImplementation(async (command) => {
      if (command === 'startCapture') {
        return {
          profileId: 'compatible',
          codec: 'h264',
          container: 'mp4',
          hardwareEncoder: true,
          partialOutputPath: '/tmp/recording.partial',
        };
      }
      if (command === 'stopCapture') {
        return {
          status: 'completed',
          filePath: '/tmp/recording.mp4',
          profileId: 'compatible',
          codec: 'h264',
          container: 'mp4',
          width: 960,
          height: 600,
          frameRate: 30,
          durationMs: 900,
          pausedDurationMs: 100,
          fileSizeBytes: 4_096,
          hasSystemAudio: false,
          hasMicrophone: false,
          hardwareEncoder: true,
          capturedFrames: 29,
          encodedFrames: 27,
          droppedFrames: 2,
          systemAudioSamples: 0,
          microphoneSamples: 0,
          averageFileWriteBytesPerSecond: 4_551,
          peakFileWriteBytesPerSecond: 8_192,
        };
      }
      if (command === 'getHealth') {
        return {
          state: 'capturing',
          lastHeartbeatAt: now,
          droppedFrames: 0,
          lateSamples: 0,
          pendingVideoSamples: 0,
          pendingAudioSamples: 0,
          encodedFrames: 10,
          processedSampleBytes: 3_000,
          pausedDurationMs: 0,
          writerError: null,
          partialOutputPath: '/tmp/recording.partial',
        };
      }
      return {};
    });
    const engine = new NativeRecordingEngine({
      supervisor,
      outputDirectory: async () => '/tmp/recordings',
      clock,
      events: publisher,
      progressIntervalMs: 5,
      availableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
    });

    const handle = await engine.start(validated, 'session-1');
    now += 100;
    await engine.pause(handle.id);
    now += 100;
    await engine.resume(handle.id);
    now += 800;
    const result = await engine.stop(handle.id);

    expect(result.artifact.filePath).toBe('/tmp/recording.mp4');
    expect(result.diagnostics).toMatchObject({
      width: 960,
      height: 600,
      actualFrameCount: 27,
      droppedFrameCount: 2,
      encoder: 'hardware',
    });
    expect(requestSpy.mock.calls.map(([command]) => command)).toEqual([
      'configureCapture',
      'startCapture',
      'getHealth',
      'pauseCapture',
      'resumeCapture',
      'stopCapture',
    ]);
    await engine.dispose();
  });

  it('rejects a recording before native configuration when disk space is unsafe', async () => {
    const supervisor = new NativeServiceSupervisor({
      executablePath: '/fake/CaptureService',
      clientVersion: 'test',
    });
    const request = createRecordingRequest({
      source: createCaptureSource({
        id: 'display:1',
        kind: 'display',
        name: 'Main Display',
        dimensions: { width: 1920, height: 1080 },
      }),
      region: undefined,
      profileId: 'compatible',
      resolution: '1080p',
      frameRate: 60,
      audio: { systemAudio: false, microphone: false },
      showsCursor: true,
      showsMouseClicks: false,
    });
    const events: ApplicationEvent[] = [];
    const requestSpy = vi.spyOn(supervisor, 'request');
    const engine = new NativeRecordingEngine({
      supervisor,
      outputDirectory: async () => '/tmp/recordings',
      clock: { now: () => 1_000 },
      events: { publish: (event) => events.push(event) },
      availableDiskBytes: async () => 1,
    });

    await expect(
      engine.start(
        {
          requested: request,
          effective: request,
          outputDimensions: { width: 1920, height: 1080 },
          warnings: [],
        },
        'session-low-disk',
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_DISK_SPACE' });
    expect(requestSpy).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'recording.disk-space-warning' }),
    );
  });
});
