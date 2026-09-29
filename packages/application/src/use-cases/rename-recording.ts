import {
  DomainError,
  createRecordingMetadata,
  normalizeRecordingTitle,
} from '@screen-recorder/domain';

import type { RecordingFileActionsPort } from '../ports/platform-ports';
import type { RecordingCatalogRepository } from '../ports/repositories';

export class RenameRecordingUseCase {
  public constructor(
    private readonly catalog: RecordingCatalogRepository,
    private readonly files: RecordingFileActionsPort,
  ) {}

  public async execute(recordingId: string, requestedTitle: string) {
    const recording = await this.catalog.findById(recordingId);

    if (recording === undefined) {
      throw new DomainError('RECORDING_NOT_FOUND', 'The recording is no longer in the library.');
    }

    if (recording.availability === 'missing') {
      throw new DomainError(
        'RECORDING_NOT_FOUND',
        'The recording file is missing and cannot be renamed.',
      );
    }

    const title = normalizeRecordingTitle(requestedTitle);
    const filePath = await this.files.rename(recording.filePath, title);
    const renamed = createRecordingMetadata({ ...recording, title, filePath });
    try {
      await this.catalog.save(renamed);
    } catch (error) {
      // Keep the filesystem and catalog aligned if the transactional metadata update fails.
      await this.files.rename(filePath, recording.title).catch(() => undefined);
      throw error;
    }
    return renamed;
  }
}
