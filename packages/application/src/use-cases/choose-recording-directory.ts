import { updateAppPreferences, type AppPreferences } from '@screen-recorder/domain';

import type { RecordingDirectoryPickerPort } from '../ports/platform-ports';
import type { PreferencesRepository } from '../ports/repositories';

export class ChooseRecordingDirectoryUseCase {
  public constructor(
    private readonly preferences: PreferencesRepository,
    private readonly picker: RecordingDirectoryPickerPort,
    private readonly defaultDirectory: () => string,
  ) {}

  public async execute(): Promise<AppPreferences | undefined> {
    const current = await this.preferences.get();
    const initialDirectory = current.outputDirectory.trim() || this.defaultDirectory();
    const selectedDirectory = await this.picker.selectDirectory(initialDirectory);

    // Cancelling a native dialog is expected user behavior, not an application error.
    if (selectedDirectory === undefined) return undefined;

    const updated = updateAppPreferences(current, { outputDirectory: selectedDirectory });
    await this.preferences.save(updated);
    return updated;
  }
}
