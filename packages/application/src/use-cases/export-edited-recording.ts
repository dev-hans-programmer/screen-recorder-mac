import {
  createRecordingEditPlan,
  createRecordingMetadataFromArtifact,
  DomainError,
  type RecordingEditPlanInput,
  type RecordingMetadata,
} from '@screen-recorder/domain';

import type { RecordingEditorPort } from '../ports/recording-editor-port';
import type { Logger, RecordingThumbnailPort } from '../ports/platform-ports';
import type {
  Clock,
  IdGenerator,
  RecordingCatalogRepository,
  RecordingSessionRepository,
} from '../ports/repositories';

export class ExportEditedRecordingUseCase {
  public constructor(
    private readonly catalog: RecordingCatalogRepository,
    private readonly sessions: RecordingSessionRepository,
    private readonly editor: RecordingEditorPort,
    private readonly thumbnails: RecordingThumbnailPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Logger,
  ) {}

  public async execute(input: RecordingEditPlanInput): Promise<RecordingMetadata> {
    if ((await this.sessions.findActive()) !== undefined) {
      throw new DomainError(
        'RECORDING_ALREADY_ACTIVE',
        'Finish the active recording before exporting an edit.',
      );
    }

    const source = await this.catalog.findById(input.recordingId);
    if (source === undefined || source.availability === 'missing') {
      throw new DomainError('RECORDING_NOT_FOUND', 'The source recording is unavailable.');
    }

    const plan = createRecordingEditPlan(input, source.durationMs);
    const result = await this.editor.exportRecording({
      source,
      plan,
      outputId: this.ids.next(),
      createdAt: this.clock.now(),
    });
    const recording = createRecordingMetadataFromArtifact(result.artifact);
    await this.catalog.save(recording);

    if (result.thumbnailPath !== undefined) {
      try {
        await this.thumbnails.storeFromFile(recording, result.thumbnailPath);
      } catch (error) {
        // The export remains playable; the library can lazily regenerate a fallback thumbnail.
        this.logger.warn('The selected editor poster frame could not be cached.', { error });
      }
    }

    return recording;
  }
}
