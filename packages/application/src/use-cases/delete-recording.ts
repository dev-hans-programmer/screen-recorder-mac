import { DomainError } from '@screen-recorder/domain';

import type { RecordingFileActionsPort, RecordingThumbnailPort } from '../ports/platform-ports';
import type { RecordingCatalogRepository } from '../ports/repositories';

export class DeleteRecordingUseCase {
  public constructor(
    private readonly catalog: RecordingCatalogRepository,
    private readonly files: RecordingFileActionsPort,
    private readonly thumbnails: RecordingThumbnailPort,
  ) {}

  public async execute(recordingId: string): Promise<void> {
    const recording = await this.catalog.findById(recordingId);

    if (recording === undefined) {
      throw new DomainError('RECORDING_NOT_FOUND', 'The recording is no longer in the library.');
    }

    // Trash is intentionally used instead of permanent deletion so the action remains recoverable.
    if (recording.availability === 'available') {
      await this.files.moveToTrash(recording.filePath);
    }

    await this.catalog.remove(recording.id);
    // Cache cleanup must not turn an already-successful Trash operation into a visible failure.
    await this.thumbnails.remove(recording.id).catch(() => undefined);
  }
}
