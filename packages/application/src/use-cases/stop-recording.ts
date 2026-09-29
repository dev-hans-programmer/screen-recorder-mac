import { DomainError } from '@screen-recorder/domain';

import type { RecordingEnginePort } from '../ports/recording-engine-port';
import type {
  ApplicationEventPublisher,
  Clock,
  RecordingSessionRepository,
} from '../ports/repositories';

export class StopRecordingUseCase {
  public constructor(
    private readonly sessions: RecordingSessionRepository,
    private readonly engine: RecordingEnginePort,
    private readonly clock: Clock,
    private readonly events: ApplicationEventPublisher,
  ) {}

  public async execute(sessionId: string) {
    const session = await this.sessions.findById(sessionId);

    const handleId = session?.toSnapshot().engineHandleId;

    if (session === undefined || handleId === undefined) {
      throw new DomainError('RECORDING_NOT_FOUND', `Recording session ${sessionId} was not found.`);
    }

    session.stop(this.clock.now());
    await this.sessions.save(session);

    try {
      const artifact = await this.engine.stop(handleId);
      const completedAt = this.clock.now();
      session.complete(completedAt, artifact);
      await this.sessions.save(session);
      this.events.publish({
        version: 1,
        type: 'recording.state-changed',
        sessionId,
        state: session.state,
        occurredAt: completedAt,
      });
      this.events.publish({
        version: 1,
        type: 'recording.completed',
        sessionId,
        artifact,
        occurredAt: completedAt,
      });

      return artifact;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'The recording could not be finalized.';
      session.fail(this.clock.now(), reason);
      await this.sessions.save(session);
      this.events.publish({
        version: 1,
        type: 'recording.failed',
        sessionId,
        reason,
        occurredAt: this.clock.now(),
      });
      throw error;
    }
  }
}
