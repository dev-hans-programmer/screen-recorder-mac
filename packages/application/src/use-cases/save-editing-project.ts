import { DomainError, type EditingProject } from '@screen-recorder/domain';

import type {
  EditingProjectRepository,
  RecordingCatalogRepository,
  Clock,
} from '../ports/repositories';

export class SaveEditingProjectUseCase {
  public constructor(
    private readonly catalog: RecordingCatalogRepository,
    private readonly projects: EditingProjectRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(project: EditingProject): Promise<EditingProject> {
    const recording = await this.catalog.findById(project.recordingId);
    if (recording === undefined || recording.availability === 'missing') {
      throw new DomainError('RECORDING_NOT_FOUND', 'The source recording is unavailable.');
    }
    if (project.durationMs !== recording.durationMs) {
      throw new DomainError(
        'INVALID_VALUE',
        'The project duration must match its source recording.',
      );
    }
    const trackIds = new Set(project.tracks.map((track) => track.id));
    if (trackIds.size !== project.tracks.length) {
      throw new DomainError('INVALID_VALUE', 'Editing project track identifiers must be unique.');
    }
    const hasOutOfBoundsClip = project.tracks.some((track) =>
      track.clips.some(
        (clip) =>
          clip.sourceRecordingId !== project.recordingId ||
          clip.sourceStartMs + clip.durationMs > recording.durationMs + 1 ||
          clip.timelineStartMs + clip.durationMs > project.durationMs + 1,
      ),
    );
    if (hasOutOfBoundsClip) {
      throw new DomainError('INVALID_VALUE', 'Every timeline clip must remain inside its project.');
    }
    const saved = { ...project, updatedAt: this.clock.now() };
    await this.projects.save(saved);
    return saved;
  }
}
