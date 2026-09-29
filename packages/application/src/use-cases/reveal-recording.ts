import { DomainError } from '@screen-recorder/domain';

import type { RecordingFileActionsPort } from '../ports/platform-ports';
import type { RecordingCatalogRepository } from '../ports/repositories';

export class RevealRecordingUseCase {
  public constructor(
    private readonly catalog: RecordingCatalogRepository,
    private readonly files: RecordingFileActionsPort,
  ) {}

  public async execute(recordingId: string): Promise<void> {
    const recording = await this.catalog.findById(recordingId);
    if (recording === undefined || recording.availability === 'missing') {
      throw new DomainError('RECORDING_NOT_FOUND', 'The recording file is missing.');
    }
    await this.files.reveal(recording.filePath);
  }
}
