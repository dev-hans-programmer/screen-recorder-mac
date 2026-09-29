import type { RecordingThumbnailPort } from '../ports/platform-ports';
import type { RecordingCatalogRepository } from '../ports/repositories';

export class GetRecordingThumbnailUseCase {
  public constructor(
    private readonly catalog: RecordingCatalogRepository,
    private readonly thumbnails: RecordingThumbnailPort,
  ) {}

  public async execute(recordingId: string): Promise<string | undefined> {
    const recording = await this.catalog.findById(recordingId);
    if (recording === undefined || recording.availability === 'missing') return undefined;
    return this.thumbnails.getDataUrl(recording);
  }
}
