import type { AppPreferences } from '@screen-recorder/domain';

import type { PreferencesRepository } from '../ports/repositories';

export class GetPreferencesUseCase {
  public constructor(private readonly preferences: PreferencesRepository) {}

  public execute(): Promise<AppPreferences> {
    return this.preferences.get();
  }
}
