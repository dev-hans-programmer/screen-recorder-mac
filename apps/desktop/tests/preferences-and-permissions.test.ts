import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const shellMocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: shellMocks.showOpenDialog },
  shell: shellMocks,
}));

import { defaultAppPreferences, updateAppPreferences } from '@screen-recorder/domain';

import { JsonPreferencesRepository } from '../src/main/infrastructure/json-preferences-repository';
import { ElectronRecordingDirectoryPicker } from '../src/main/infrastructure/electron-recording-directory-picker';
import { MacOsSystemSettings } from '../src/main/infrastructure/macos-system-settings';

const temporaryDirectories: string[] = [];
const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'screen-recorder-preferences-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.clearAllMocks();
});

describe('JSON preferences repository', () => {
  it('atomically persists every preference and restores it after a restart', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'preferences.json');
    const saved = updateAppPreferences(defaultAppPreferences, {
      outputDirectory: '/tmp/Screen Recordings',
      defaultProfileId: 'master',
      defaultResolution: '4k',
      defaultFrameRate: 30,
      systemAudioEnabled: false,
      microphoneEnabled: true,
      theme: 'dark',
      onboardingCompleted: true,
      shortcuts: {
        startStop: 'CommandOrControl+Option+R',
        pauseResume: 'CommandOrControl+Option+P',
      },
    });

    await new JsonPreferencesRepository({ filePath, logger }).save(saved);
    const restored = await new JsonPreferencesRepository({ filePath, logger }).get();
    const envelope = JSON.parse(await readFile(filePath, 'utf8')) as {
      schemaVersion: number;
      preferences: unknown;
    };

    expect(restored).toEqual(saved);
    expect(envelope).toEqual({ schemaVersion: 1, preferences: saved });
    expect(await readdir(directory)).toEqual(['preferences.json']);
  });

  it('quarantines invalid preferences and safely restores defaults', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'preferences.json');
    await writeFile(filePath, '{broken json');
    const repository = new JsonPreferencesRepository({ filePath, logger, now: () => 42 });

    await expect(repository.get()).resolves.toEqual(defaultAppPreferences);
    expect(await readdir(directory)).toEqual(['preferences.json.corrupt-42']);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('migrates pre-envelope preferences without losing user choices', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'preferences.json');
    const legacyPreferences = updateAppPreferences(defaultAppPreferences, {
      outputDirectory: '/Users/tester/Movies/Important Recordings',
      defaultProfileId: 'master',
      microphoneEnabled: true,
      onboardingCompleted: true,
    });
    await writeFile(filePath, `${JSON.stringify(legacyPreferences)}\n`, 'utf8');

    const restored = await new JsonPreferencesRepository({ filePath, logger }).get();
    const migrated = JSON.parse(await readFile(filePath, 'utf8')) as {
      schemaVersion: number;
      preferences: unknown;
    };

    expect(restored).toEqual(legacyPreferences);
    expect(migrated).toEqual({ schemaVersion: 1, preferences: legacyPreferences });
    expect(logger.info).toHaveBeenCalledWith('Saved preferences were migrated.', {
      schemaVersion: 1,
    });
  });

  it('preserves preferences written by a newer app instead of downgrading them', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'preferences.json');
    const futureEnvelope = { schemaVersion: 99, preferences: defaultAppPreferences };
    await writeFile(filePath, `${JSON.stringify(futureEnvelope)}\n`, 'utf8');

    const repository = new JsonPreferencesRepository({ filePath, logger });

    await expect(repository.get()).rejects.toThrow('newer application version');
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(futureEnvelope);
    expect(await readdir(directory)).toEqual(['preferences.json']);
  });
});

describe('macOS permission recovery', () => {
  it('opens the correct System Settings privacy panes', async () => {
    const settings = new MacOsSystemSettings();

    await settings.openPermissionSettings('screen-recording');
    await settings.openPermissionSettings('microphone');

    expect(shellMocks.openExternal).toHaveBeenNthCalledWith(
      1,
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
    expect(shellMocks.openExternal).toHaveBeenNthCalledWith(
      2,
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    );
  });
});

describe('recording directory picker', () => {
  it('opens a native directory-only dialog and returns the selected folder', async () => {
    shellMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Users/tester/Movies/Captures'],
    });
    const picker = new ElectronRecordingDirectoryPicker({ getParentWindow: () => null });

    await expect(picker.selectDirectory('/Users/tester/Movies')).resolves.toBe(
      '/Users/tester/Movies/Captures',
    );
    expect(shellMocks.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '/Users/tester/Movies',
        properties: ['openDirectory', 'createDirectory'],
      }),
    );
  });

  it('returns undefined when folder selection is cancelled', async () => {
    shellMocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const picker = new ElectronRecordingDirectoryPicker({ getParentWindow: () => null });

    await expect(picker.selectDirectory('/Users/tester/Movies')).resolves.toBeUndefined();
  });
});
