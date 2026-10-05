import {
  createInitialEditingProject,
  DomainError,
  type EditingProject,
} from '@screen-recorder/domain';

import type {
  EditingProjectRepository,
  RecordingCatalogRepository,
  Clock,
} from '../ports/repositories';

export class GetOrCreateEditingProjectUseCase {
  public constructor(
    private readonly catalog: RecordingCatalogRepository,
    private readonly projects: EditingProjectRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(recordingId: string): Promise<EditingProject> {
    const recording = await this.catalog.findById(recordingId);
    if (recording === undefined || recording.availability === 'missing') {
      throw new DomainError('RECORDING_NOT_FOUND', 'The source recording is unavailable.');
    }
    const existing = await this.projects.findByRecordingId(recordingId);
    if (existing !== undefined) return existing;
    const project = createInitialEditingProject(recording, this.clock.now());
    await this.projects.save(project);
    return project;
  }
}
