import type { RecordingMetadata } from '@screen-recorder/domain';

import type { RecordingCatalogRepository } from '../ports/repositories';

export class ListRecordingsUseCase {
  public constructor(private readonly catalog: RecordingCatalogRepository) {}

  public execute(): Promise<readonly RecordingMetadata[]> {
    return this.catalog.list();
  }
}
