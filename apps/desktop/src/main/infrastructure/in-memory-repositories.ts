import {
  defaultAppPreferences,
  type AppPreferences,
  type RecordingMetadata,
  type RecordingSession,
} from '@screen-recorder/domain';

import type {
  PreferencesRepository,
  RecordingCatalogRepository,
  RecordingSessionRepository,
} from '@screen-recorder/application';

export class InMemoryRecordingRepository implements RecordingSessionRepository {
  private readonly sessions = new Map<string, RecordingSession>();

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
    return Promise.resolve();
  }
}

export class InMemoryRecordingCatalogRepository implements RecordingCatalogRepository {
  private readonly recordings = new Map<string, RecordingMetadata>();

  public list(): Promise<readonly RecordingMetadata[]> {
    return Promise.resolve([...this.recordings.values()]);
  }

  public findById(id: string): Promise<RecordingMetadata | undefined> {
    return Promise.resolve(this.recordings.get(id));
  }

  public save(recording: RecordingMetadata): Promise<void> {
    this.recordings.set(recording.id, recording);
    return Promise.resolve();
  }

  public remove(id: string): Promise<void> {
    this.recordings.delete(id);
    return Promise.resolve();
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
