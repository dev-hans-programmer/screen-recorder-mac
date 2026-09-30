import { DomainError, createRecordingMetadataFromArtifact } from '@screen-recorder/domain';

import type { RecordingEnginePort } from '../ports/recording-engine-port';
import type {
  ApplicationEventPublisher,
  Clock,
  RecordingCatalogRepository,
  RecordingDiagnosticsRepository,
  RecordingSessionRepository,
} from '../ports/repositories';

export class StopRecordingUseCase {
  public constructor(
    private readonly sessions: RecordingSessionRepository,
    private readonly catalog: RecordingCatalogRepository,
    private readonly diagnostics: RecordingDiagnosticsRepository,
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
      const result = await this.engine.stop(handleId);
      const completedAt = this.clock.now();
      await this.catalog.save(createRecordingMetadataFromArtifact(result.artifact));
      try {
        await this.diagnostics.save(result.diagnostics);
      } catch {
        // A support-metadata failure must never invalidate a playable recording.
        this.events.publish({
          version: 1,
          type: 'recording.warning',
          sessionId,
          code: 'DIAGNOSTICS_PERSISTENCE_FAILED',
          message: 'Recording diagnostics could not be saved.',
          occurredAt: completedAt,
        });
      }
      session.complete(completedAt, result.artifact);
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
        artifact: result.artifact,
        occurredAt: completedAt,
      });

      return result.artifact;
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
