import { DomainError } from '@screen-recorder/domain';

import type { RecordingEnginePort } from '../ports/recording-engine-port';
import type {
  ApplicationEventPublisher,
  Clock,
  RecordingSessionRepository,
} from '../ports/repositories';

export class PauseRecordingUseCase {
  public constructor(
    private readonly sessions: RecordingSessionRepository,
    private readonly engine: RecordingEnginePort,
    private readonly clock: Clock,
    private readonly events: ApplicationEventPublisher,
  ) {}

  public async execute(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);

    const handleId = session?.toSnapshot().engineHandleId;

    if (session === undefined || handleId === undefined) {
      throw new DomainError('RECORDING_NOT_FOUND', `Recording session ${sessionId} was not found.`);
    }

    await this.engine.pause(handleId);
    const occurredAt = this.clock.now();
    session.pause(occurredAt);
    await this.sessions.save(session);
    this.events.publish({
      version: 1,
      type: 'recording.state-changed',
      sessionId,
      state: session.state,
      occurredAt,
    });
  }
}
