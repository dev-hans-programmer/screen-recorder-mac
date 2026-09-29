import { DomainError } from '../errors/domain-error';
import type {
  FrameRate,
  RecordingProfileId,
  RecordingResolution,
} from '../recording/recording-profile';
import { getRecordingProfile } from '../recording/recording-profile';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface ShortcutPreferences {
  readonly startStop: string;
  readonly pauseResume: string;
}

export interface AppPreferences {
  readonly outputDirectory: string;
  readonly defaultProfileId: RecordingProfileId;
  readonly defaultResolution: RecordingResolution;
  readonly defaultFrameRate: FrameRate;
  readonly systemAudioEnabled: boolean;
  readonly microphoneEnabled: boolean;
  readonly theme: ThemePreference;
  readonly shortcuts: ShortcutPreferences;
}

export type AppPreferencesPatch = Partial<Omit<AppPreferences, 'shortcuts'>> & {
  readonly shortcuts?: Partial<ShortcutPreferences>;
};

export const defaultAppPreferences: AppPreferences = Object.freeze({
  outputDirectory: '',
  defaultProfileId: 'balanced',
  defaultResolution: 'source',
  defaultFrameRate: 60,
  systemAudioEnabled: true,
  microphoneEnabled: false,
  theme: 'system',
  shortcuts: Object.freeze({
    startStop: 'CommandOrControl+Shift+R',
    pauseResume: 'CommandOrControl+Shift+P',
  }),
});

export function updateAppPreferences(
  current: AppPreferences,
  patch: AppPreferencesPatch,
): AppPreferences {
  if (patch.outputDirectory !== undefined && patch.outputDirectory.trim().length === 0) {
    throw new DomainError('INVALID_PREFERENCES', 'The output directory cannot be empty.');
  }

  if (patch.defaultProfileId !== undefined) {
    getRecordingProfile(patch.defaultProfileId);
  }

  if (patch.shortcuts?.startStop !== undefined && patch.shortcuts.startStop.trim().length === 0) {
    throw new DomainError('INVALID_PREFERENCES', 'The start/stop shortcut cannot be empty.');
  }

  if (
    patch.shortcuts?.pauseResume !== undefined &&
    patch.shortcuts.pauseResume.trim().length === 0
  ) {
    throw new DomainError('INVALID_PREFERENCES', 'The pause/resume shortcut cannot be empty.');
  }

  return Object.freeze({
    ...current,
    ...patch,
    shortcuts: Object.freeze({
      ...current.shortcuts,
      ...patch.shortcuts,
    }),
  });
}
