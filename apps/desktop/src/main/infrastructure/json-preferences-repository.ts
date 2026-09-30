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
      if (
        typeof raw !== 'object' ||
        raw === null ||
        !('schemaVersion' in raw) ||
        raw.schemaVersion !== appPreferencesSchemaVersion ||
        !('preferences' in raw)
      ) {
        throw new Error('The preferences envelope is invalid.');
      }

      const parsed = parseAppPreferencesDto(raw.preferences);
      this.current = Object.freeze({
        ...parsed,
        shortcuts: Object.freeze({ ...parsed.shortcuts }),
      });
      return this.current;
    } catch (error) {
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
