import type { RecordingSessionSnapshot } from '@screen-recorder/domain';

import type {
  ApplicationEventPublisher,
  Clock,
  RecordingSessionRepository,
} from '../ports/repositories';

export class RecoverInterruptedRecordingUseCase {
  public constructor(
    private readonly sessions: RecordingSessionRepository,
    private readonly clock: Clock,
    private readonly events: ApplicationEventPublisher,
  ) {}

  public async execute(): Promise<RecordingSessionSnapshot | undefined> {
    const session = await this.sessions.findActive();

    if (session === undefined) {
      return undefined;
    }

    const reason = 'The previous recording session was interrupted before finalization.';
    const occurredAt = this.clock.now();
    session.fail(occurredAt, reason);
    await this.sessions.save(session);
    this.events.publish({
      version: 1,
      type: 'recording.failed',
      sessionId: session.id,
      reason,
      occurredAt,
    });

    return session.toSnapshot();
  }
}
