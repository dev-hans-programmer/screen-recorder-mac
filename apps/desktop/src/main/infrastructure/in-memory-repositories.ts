import {
  defaultAppPreferences,
  type AppPreferences,
  type RecordingArtifact,
  type RecordingSession,
} from '@screen-recorder/domain';

import type {
  PreferencesRepository,
  RecordingCatalogRepository,
  RecordingSessionRepository,
} from '@screen-recorder/application';

export class InMemoryRecordingRepository
  implements RecordingSessionRepository, RecordingCatalogRepository
{
  private readonly sessions = new Map<string, RecordingSession>();
  private readonly artifacts: RecordingArtifact[] = [];

  public findActive(): Promise<RecordingSession | undefined> {
    const active = [...this.sessions.values()].find((session) =>
      ['preparing', 'capturing', 'paused', 'stopping'].includes(session.state),
    );

    return Promise.resolve(active);
  }

  public findById(id: string): Promise<RecordingSession | undefined> {
    return Promise.resolve(this.sessions.get(id));
  }

  public save(session: RecordingSession): Promise<void> {
    this.sessions.set(session.id, session);
    const artifact = session.toSnapshot().artifact;

    if (artifact !== undefined && !this.artifacts.some((item) => item.id === artifact.id)) {
      this.artifacts.push(artifact);
    }

    return Promise.resolve();
  }

  public list(): Promise<readonly RecordingArtifact[]> {
    return Promise.resolve([...this.artifacts]);
  }
}

export class InMemoryPreferencesRepository implements PreferencesRepository {
  private preferences: AppPreferences = defaultAppPreferences;

  public get(): Promise<AppPreferences> {
    return Promise.resolve(this.preferences);
  }

  public save(preferences: AppPreferences): Promise<void> {
    this.preferences = preferences;
    return Promise.resolve();
  }
}
