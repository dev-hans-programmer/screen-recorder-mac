import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const shellMocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
}));

vi.mock('electron', () => ({ shell: shellMocks }));

import { defaultAppPreferences, updateAppPreferences } from '@screen-recorder/domain';

import { JsonPreferencesRepository } from '../src/main/infrastructure/json-preferences-repository';
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
