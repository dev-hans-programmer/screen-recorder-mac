import path from 'node:path';

import {
  createDurationMs,
  createRecordingDiagnostics,
  createRecordingArtifact,
  createRecordingFilePath,
  DomainError,
  isRecordingProfileId,
  type RecordingArtifact,
} from '@screen-recorder/domain';
import type {
  ApplicationEventPublisher,
  CaptureCapabilities,
  CapturePermissionRequest,
  CapturePort,
  Clock,
  Logger,
  RecordingEngineHandle,
  RecordingEnginePort,
  RecordingEngineStopResult,
  ValidatedRecordingRequest,
} from '@screen-recorder/application';

import type { NativeRequestOptions } from './capture-service-client';
import { NativeServiceSupervisor } from './native-service-supervisor';
import {
  mapNativeSource,
  parseNativeCapabilities,
  parseNativeHealth,
  parseNativePermissions,
  parseNativeRecordingResult,
  parseNativeRecordingStart,
  parseNativeSources,
  toCaptureCapabilities,
  toNativeDomainError,
} from './native-mappers';

export class NativeCapturePort implements CapturePort {
  public constructor(private readonly supervisor: NativeServiceSupervisor) {}

  public async listSources() {
    try {
      const value = await this.supervisor.request('listSources');
      return parseNativeSources(value).map(mapNativeSource);
    } catch (error) {
      throw toNativeDomainError(error);
    }
  }

  public async getCapabilities(): Promise<CaptureCapabilities> {
    try {
      const value = await this.supervisor.request('getCapabilities');
      return toCaptureCapabilities(parseNativeCapabilities(value));
    } catch (error) {
      throw toNativeDomainError(error);
    }
  }

  public async getPermissions() {
    try {
      return parseNativePermissions(await this.supervisor.request('getPermissions'));
    } catch (error) {
      throw toNativeDomainError(error);
    }
  }

  public async requestPermissions(request: CapturePermissionRequest) {
    try {
      return parseNativePermissions(
        await this.supervisor.request('requestPermissions', { microphone: request.microphone }),
      );
    } catch (error) {
      throw toNativeDomainError(error);
    }
  }
}

interface ActiveNativeRecording {
  readonly sessionId: string;
  readonly request: ValidatedRecordingRequest;
  readonly startedAt: number;
  readonly progressTimer: ReturnType<typeof setInterval>;
  pausedAt: number | undefined;
  pausedDurationMs: number;
  progressRequestInFlight: boolean;
  lastDroppedFrames: number;
}

export interface NativeRecordingEngineOptions {
  readonly supervisor: NativeServiceSupervisor;
  readonly outputDirectory: () => Promise<string>;
  readonly clock: Clock;
  readonly events: ApplicationEventPublisher;
  readonly logger?: Logger;
  readonly progressIntervalMs?: number;
}

export class NativeRecordingEngine implements RecordingEnginePort {
  private readonly supervisor: NativeServiceSupervisor;
  private readonly outputDirectory: () => Promise<string>;
  private readonly clock: Clock;
  private readonly events: ApplicationEventPublisher;
  private readonly logger: Logger | undefined;
  private readonly progressIntervalMs: number;
  private active: ActiveNativeRecording | undefined;

  public constructor(options: NativeRecordingEngineOptions) {
    this.supervisor = options.supervisor;
    this.outputDirectory = options.outputDirectory;
    this.clock = options.clock;
    this.events = options.events;
    this.logger = options.logger;
    this.progressIntervalMs = options.progressIntervalMs ?? 500;
  }

  public async start(
    request: ValidatedRecordingRequest,
    sessionId: string,
  ): Promise<RecordingEngineHandle> {
    this.supervisor.reserveRecording(sessionId);

    try {
      const outputDirectory = await this.outputDirectory();
      if (outputDirectory.trim().length === 0) {
        throw new DomainError('INVALID_PREFERENCES', 'The output directory cannot be empty.');
      }

      await this.request('configureCapture', {
        sourceId: request.effective.source.id,
        sourceKind: request.effective.source.kind,
        region: request.effective.region ?? null,
        width: request.outputDimensions.width,
        height: request.outputDimensions.height,
        frameRate: request.effective.frameRate,
        profileId: request.effective.profileId,
        outputDirectory,
        showsCursor: request.effective.showsCursor,
        showsMouseClicks: request.effective.showsMouseClicks,
        systemAudio: request.effective.audio.systemAudio,
        microphone: request.effective.audio.microphone,
        microphoneDeviceId: request.effective.audio.microphoneDeviceId ?? null,
      });

      const start = parseNativeRecordingStart(await this.request('startCapture'));
      if (!isRecordingProfileId(start.profileId)) {
        throw new DomainError(
          'NATIVE_SERVICE_FAILURE',
          'Native service returned an unknown profile.',
        );
      }

      const startedAt = this.clock.now();
      const active: Omit<ActiveNativeRecording, 'progressTimer'> = {
        sessionId,
        request,
        startedAt,
        pausedAt: undefined,
        pausedDurationMs: 0,
        progressRequestInFlight: false,
        lastDroppedFrames: 0,
      };
      this.supervisor.commitRecording(sessionId);
      this.active = {
        ...active,
        progressTimer: setInterval(() => void this.publishProgress(), this.progressIntervalMs),
      };
      this.logger?.info('Native recording started.', {
        sessionId,
        profileId: request.effective.profileId,
        width: request.outputDimensions.width,
        height: request.outputDimensions.height,
        frameRate: request.effective.frameRate,
        systemAudio: request.effective.audio.systemAudio,
        microphone: request.effective.audio.microphone,
        encoder: start.hardwareEncoder ? 'hardware' : 'software',
      });
      // Publish once immediately so the renderer does not wait for the first polling interval
      // before it receives a live duration/byte snapshot.
      void this.publishProgress();
      return { id: sessionId };
    } catch (error) {
      this.logger?.error('Native recording failed to start.', { sessionId, error });
      this.supervisor.releaseRecording(sessionId);
      throw toNativeDomainError(error);
    }
  }

  public async pause(handleId: string): Promise<void> {
    const active = this.requireActive(handleId);

    try {
      await this.request('pauseCapture');
      active.pausedAt = this.clock.now();
      this.logger?.info('Native recording paused.', { sessionId: active.sessionId });
    } catch (error) {
      throw toNativeDomainError(error);
    }
  }

  public async resume(handleId: string): Promise<void> {
    const active = this.requireActive(handleId);

    try {
      await this.request('resumeCapture');
      if (active.pausedAt !== undefined) {
        active.pausedDurationMs += Math.max(0, this.clock.now() - active.pausedAt);
        active.pausedAt = undefined;
      }
      this.logger?.info('Native recording resumed.', { sessionId: active.sessionId });
    } catch (error) {
      throw toNativeDomainError(error);
    }
  }

  public async stop(handleId: string): Promise<RecordingEngineStopResult> {
    const active = this.requireActive(handleId);
    clearInterval(active.progressTimer);

    try {
      const result = parseNativeRecordingResult(
        await this.request('stopCapture', null, { timeoutMs: 30_000 }),
      );
      const completed = {
        artifact: createArtifact(result, active),
        diagnostics: createRecordingDiagnostics({
          schemaVersion: 1,
          sessionId: active.sessionId,
          recordedAt: this.clock.now(),
          width: result.width,
          height: result.height,
          durationMs: result.durationMs,
          capturedFrameCount: result.capturedFrames,
          actualFrameCount: result.encodedFrames,
          droppedFrameCount: result.droppedFrames,
          codec: result.codec as 'h264' | 'hevc' | 'prores422',
          encoder: result.hardwareEncoder ? 'hardware' : 'software',
          systemAudio: audioTrackState(
            active.request.effective.audio.systemAudio,
            result.systemAudioSamples,
          ),
          microphone: audioTrackState(
            active.request.effective.audio.microphone,
            result.microphoneSamples,
          ),
          fileSizeBytes: result.fileSizeBytes,
          averageFileWriteBytesPerSecond: result.averageFileWriteBytesPerSecond,
          peakFileWriteBytesPerSecond: result.peakFileWriteBytesPerSecond,
        }),
      };
      this.logger?.info('Recording performance summary.', {
        ...completed.diagnostics,
      });
      return completed;
    } catch (error) {
      this.logger?.error('Native recording failed to stop.', {
        sessionId: active.sessionId,
        error,
      });
      throw toNativeDomainError(error);
    } finally {
      this.active = undefined;
      this.supervisor.releaseRecording(handleId);
    }
  }

  public async dispose(): Promise<void> {
    if (this.active !== undefined) {
      clearInterval(this.active.progressTimer);
      this.active = undefined;
    }
    await this.supervisor.dispose();
  }

  private requireActive(handleId: string): ActiveNativeRecording {
    if (this.active?.sessionId !== handleId) {
      throw new DomainError(
        'RECORDING_NOT_FOUND',
        `Native recording session ${handleId} was not found.`,
      );
    }

    this.supervisor.assertActive(handleId);
    return this.active;
  }

  private request<TResponse = unknown>(
    command: Parameters<NativeServiceSupervisor['request']>[0],
    payload: unknown = null,
    options?: NativeRequestOptions,
  ): Promise<TResponse> {
    return this.supervisor.request<TResponse>(command, payload, options);
  }

  private async publishProgress(): Promise<void> {
    const active = this.active;
    if (active === undefined || active.progressRequestInFlight) {
      return;
    }

    active.progressRequestInFlight = true;
    try {
      const health = parseNativeHealth(await this.request('getHealth', null, { timeoutMs: 1_000 }));
      if (this.active?.sessionId !== active.sessionId) {
        return;
      }

      const now = this.clock.now();
      const pausedDuration =
        active.pausedDurationMs +
        (active.pausedAt === undefined ? 0 : Math.max(0, now - active.pausedAt));
      this.events.publish({
        version: 1,
        type: 'recording.progress',
        sessionId: active.sessionId,
        durationMs: Math.max(0, now - active.startedAt - pausedDuration),
        encodedBytes: health.processedSampleBytes,
        occurredAt: now,
      });

      if (health.droppedFrames > active.lastDroppedFrames) {
        active.lastDroppedFrames = health.droppedFrames;
        this.events.publish({
          version: 1,
          type: 'recording.dropped-frames',
          sessionId: active.sessionId,
          droppedFrames: health.droppedFrames,
          totalFrames: Math.max(health.encodedFrames + health.droppedFrames, 1),
          occurredAt: now,
        });
      }
    } catch {
      // The supervisor emits the controlled native-service failure event. A polling error should
      // not create a second competing application state transition.
    } finally {
      active.progressRequestInFlight = false;
    }
  }
}

function audioTrackState(requested: boolean, sampleCount: number) {
  if (!requested) return 'disabled' as const;
  return sampleCount > 0 ? ('active' as const) : ('empty' as const);
}

function createArtifact(
  result: ReturnType<typeof parseNativeRecordingResult>,
  active: ActiveNativeRecording,
): RecordingArtifact {
  if (result.status !== 'completed' || !isRecordingProfileId(result.profileId)) {
    throw new DomainError(
      'RECORDING_FINALIZATION_FAILURE',
      'Native recording did not complete successfully.',
    );
  }

  if (result.frameRate !== 30 && result.frameRate !== 60) {
    throw new DomainError(
      'NATIVE_SERVICE_FAILURE',
      'Native recording returned an unsupported frame rate.',
    );
  }

  if (result.codec !== 'h264' && result.codec !== 'hevc' && result.codec !== 'prores422') {
    throw new DomainError('UNSUPPORTED_CODEC', `Native recording returned ${result.codec}.`);
  }

  const title = path.basename(result.filePath, path.extname(result.filePath));
  return createRecordingArtifact({
    id: `${active.sessionId}-artifact`,
    filePath: createRecordingFilePath(result.filePath),
    title,
    createdAt: active.startedAt,
    durationMs: createDurationMs(result.durationMs),
    width: result.width,
    height: result.height,
    frameRate: result.frameRate,
    profileId: result.profileId,
    codec: result.codec,
    hasSystemAudio: result.hasSystemAudio,
    hasMicrophone: result.hasMicrophone,
    fileSizeBytes: result.fileSizeBytes,
  });
}
