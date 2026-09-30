import { DomainError, type RecordingFilePath } from '@screen-recorder/domain';

import type { RecordingPreviewPort } from '../ports/platform-ports';
import type { RecordingCatalogRepository } from '../ports/repositories';

/** Resolves the original H.264 file or prepares a compatible proxy for HEVC/ProRes sources. */
export class GetRecordingPreviewUseCase {
  public constructor(
    private readonly catalog: RecordingCatalogRepository,
    private readonly previews: RecordingPreviewPort,
  ) {}

  public async execute(recordingId: string): Promise<RecordingFilePath> {
    const recording = await this.catalog.findById(recordingId);
    if (recording === undefined || recording.availability === 'missing') {
      throw new DomainError('RECORDING_NOT_FOUND', 'The recording media is unavailable.');
    }

    return recording.codec === 'h264' ? recording.filePath : this.previews.prepare(recording);
  }
}
