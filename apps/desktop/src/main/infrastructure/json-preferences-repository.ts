import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Logger, PreferencesRepository } from '@screen-recorder/application';
import { parseAppPreferencesDto } from '@screen-recorder/contracts';
import {
  appPreferencesSchemaVersion,
  defaultAppPreferences,
  type AppPreferences,
} from '@screen-recorder/domain';

interface JsonPreferencesRepositoryOptions {
  readonly filePath: string;
  readonly logger: Logger;
  readonly now?: () => number;
}

interface MigratedPreferencesEnvelope {
  readonly schemaVersion: typeof appPreferencesSchemaVersion;
  readonly preferences: unknown;
  readonly migrated: boolean;
}

class UnsupportedPreferencesSchemaError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Runs one ordered step per persisted schema version. New migrations must be appended instead of
 * changing old steps so an installation can upgrade across several skipped releases in one run.
 */
export function migratePreferencesEnvelope(raw: unknown): MigratedPreferencesEnvelope {
  if (!isRecord(raw)) throw new Error('The preferences envelope is invalid.');

  const originalVersion = 'schemaVersion' in raw ? raw.schemaVersion : 0;
  if (!Number.isInteger(originalVersion) || (originalVersion as number) < 0) {
    throw new Error('The preferences schema version is invalid.');
  }
  if ((originalVersion as number) > appPreferencesSchemaVersion) {
    throw new UnsupportedPreferencesSchemaError(
      'The preferences file was created by a newer application version.',
    );
  }

  let version = originalVersion as number;
  const preferences: unknown = 'preferences' in raw ? raw.preferences : raw;

  while (version < appPreferencesSchemaVersion) {
    switch (version) {
      case 0:
        // Version 0 was the pre-envelope shape. Its preference keys already match schema 1.
        version = 1;
        break;
      default:
        throw new Error(`No preferences migration exists from schema ${version}.`);
    }
  }

  if (preferences === undefined) throw new Error('The preferences payload is missing.');
  return {
    schemaVersion: appPreferencesSchemaVersion,
    preferences,
    migrated: originalVersion !== appPreferencesSchemaVersion,
  };
}

/** Preferences are tiny, so an fsynced temp file plus atomic rename is simpler than another DB. */
export class JsonPreferencesRepository implements PreferencesRepository {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly now: () => number;
  private current: AppPreferences | undefined;
  private loadPromise: Promise<AppPreferences> | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(options: JsonPreferencesRepositoryOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
  }

  public get(): Promise<AppPreferences> {
    if (this.current !== undefined) return Promise.resolve(this.current);
    this.loadPromise ??= this.load();
    return this.loadPromise;
  }

  public async save(preferences: AppPreferences): Promise<void> {
    const write = this.writeChain.then(() => this.writeAtomically(preferences));
    this.writeChain = write.catch(() => undefined);
    await write;
    this.current = Object.freeze({
      ...preferences,
      shortcuts: Object.freeze({ ...preferences.shortcuts }),
    });
  }

  private async load(): Promise<AppPreferences> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      const envelope = migratePreferencesEnvelope(raw);
      const parsed = parseAppPreferencesDto(envelope.preferences);
      if (envelope.migrated) {
        await this.writeAtomically(parsed);
        this.logger.info('Saved preferences were migrated.', {
          schemaVersion: envelope.schemaVersion,
        });
      }
      this.current = Object.freeze({
        ...parsed,
        shortcuts: Object.freeze({ ...parsed.shortcuts }),
      });
      return this.current;
    } catch (error) {
      // Never quarantine or overwrite valid data from a newer app during a downgrade.
      if (error instanceof UnsupportedPreferencesSchemaError) throw error;
      if (this.isMissingFile(error)) {
        this.current = defaultAppPreferences;
        return this.current;
      }

      await this.quarantineCorruptFile();
      this.logger.warn('Saved preferences were invalid and defaults have been restored.');
      this.current = defaultAppPreferences;
      return this.current;
    }
  }

  private async writeAtomically(preferences: AppPreferences): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    const file = await open(temporaryPath, 'wx', 0o600);

    try {
      await file.writeFile(
        `${JSON.stringify({
          schemaVersion: appPreferencesSchemaVersion,
          preferences,
        })}\n`,
        'utf8',
      );
      await file.sync();
    } catch (error) {
      await file.close();
      await rm(temporaryPath, { force: true });
      throw error;
    }

    await file.close();
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async quarantineCorruptFile(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`);
    } catch (error) {
      if (!this.isMissingFile(error)) throw error;
    }
  }

  private isMissingFile(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
    );
  }
}
