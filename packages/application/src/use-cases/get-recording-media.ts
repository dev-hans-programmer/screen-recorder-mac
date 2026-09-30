import { DomainError, type RecordingMetadata } from '@screen-recorder/domain';

import type { RecordingCatalogRepository } from '../ports/repositories';

export class GetRecordingMediaUseCase {
  public constructor(private readonly catalog: RecordingCatalogRepository) {}

  public async execute(recordingId: string): Promise<RecordingMetadata> {
    const recording = await this.catalog.findById(recordingId);
    if (recording === undefined || recording.availability === 'missing') {
      throw new DomainError('RECORDING_NOT_FOUND', 'The recording media is unavailable.');
    }
    return recording;
  }
}
