import {
  DomainError,
  RecordingSession,
  type RecordingRequest,
  type RecordingSessionSnapshot,
  canCaptureScreen,
} from '@screen-recorder/domain';

import type { CapturePort } from '../ports/capture-port';
import type {
  ApplicationEventPublisher,
  Clock,
  IdGenerator,
  RecordingSessionRepository,
} from '../ports/repositories';
import type { RecordingEnginePort } from '../ports/recording-engine-port';
import {
  validateRecordingRequest,
  type ValidatedRecordingRequest,
} from '../services/validate-recording-request';

export interface StartRecordingResult {
  readonly session: RecordingSessionSnapshot;
  readonly validation: ValidatedRecordingRequest;
}

export interface StartRecordingDependencies {
  readonly capture: CapturePort;
  readonly engine: RecordingEnginePort;
  readonly sessions: RecordingSessionRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly events: ApplicationEventPublisher;
}

export class StartRecordingUseCase {
  public constructor(private readonly dependencies: StartRecordingDependencies) {}

  public async execute(request: RecordingRequest): Promise<StartRecordingResult> {
    const existing = await this.dependencies.sessions.findActive();

    if (existing !== undefined) {
      throw new DomainError(
        'RECORDING_ALREADY_ACTIVE',
        'Only one recording session can be active at a time.',
      );
    }

    const permissions = await this.dependencies.capture.getPermissions();

    if (!canCaptureScreen(permissions)) {
      throw new DomainError(
        'SCREEN_RECORDING_PERMISSION_REQUIRED',
        permissions.screenRecordingRequiresRestart
          ? 'Restart Screen Recorder before capture can start.'
          : 'Screen Recording permission is required before capture can start.',
      );
    }

    if (request.audio.microphone && permissions.microphone !== 'granted') {
      throw new DomainError(
        'UNSUPPORTED_AUDIO',
        'Microphone permission is required when microphone capture is enabled.',
      );
    }

    const validation = validateRecordingRequest(
      request,
      await this.dependencies.capture.getCapabilities(),
    );
    const createdAt = this.dependencies.clock.now();
    const session = RecordingSession.create(this.dependencies.ids.next(), createdAt);

    session.prepare(createdAt);
    await this.dependencies.sessions.save(session);

    try {
      const handle = await this.dependencies.engine.start(validation, session.id);
      session.start(this.dependencies.clock.now(), handle.id);
      await this.dependencies.sessions.save(session);
      this.dependencies.events.publish({
        version: 1,
        type: 'recording.state-changed',
        sessionId: session.id,
        state: session.state,
        occurredAt: this.dependencies.clock.now(),
      });

      for (const warning of validation.warnings) {
        this.dependencies.events.publish({
          version: 1,
          type: 'recording.warning',
          sessionId: session.id,
          code: warning.code,
          message: warning.message,
          occurredAt: this.dependencies.clock.now(),
        });
      }

      return { session: session.toSnapshot(), validation };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'The recording engine failed to start.';
      session.fail(this.dependencies.clock.now(), reason);
      await this.dependencies.sessions.save(session);
      this.dependencies.events.publish({
        version: 1,
        type: 'recording.failed',
        sessionId: session.id,
        reason,
        occurredAt: this.dependencies.clock.now(),
      });
      throw error;
    }
  }
}
