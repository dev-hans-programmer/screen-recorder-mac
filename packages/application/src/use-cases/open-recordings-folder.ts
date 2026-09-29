import type { RecordingFileActionsPort } from '../ports/platform-ports';

export class OpenRecordingsFolderUseCase {
  public constructor(
    private readonly files: RecordingFileActionsPort,
    private readonly getDirectory: () => Promise<string>,
  ) {}

  public async execute(): Promise<void> {
    await this.files.openDirectory(await this.getDirectory());
  }
}
