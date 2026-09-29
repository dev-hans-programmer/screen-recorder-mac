import {
  updateAppPreferences,
  type AppPreferences,
  type AppPreferencesPatch,
} from '@screen-recorder/domain';

import type { PreferencesRepository } from '../ports/repositories';

export class UpdatePreferencesUseCase {
  public constructor(private readonly preferences: PreferencesRepository) {}

  public async execute(patch: AppPreferencesPatch): Promise<AppPreferences> {
    const current = await this.preferences.get();
    const updated = updateAppPreferences(current, patch);
    await this.preferences.save(updated);
    return updated;
  }
}
