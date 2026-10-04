import { access } from 'node:fs/promises';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  createDurationMs,
  createRecordingFilePath,
  createRecordingMetadata,
  recordingMetadataSchemaVersion,
  type RecordingAvailability,
  type RecordingCodec,
  type RecordingMetadata,
  type RecordingProfileId,
} from '@screen-recorder/domain';
import type { Logger, RecordingCatalogRepository } from '@screen-recorder/application';

interface SqliteRecordingCatalogOptions {
  readonly databasePath: string;
  readonly logger: Logger;
  readonly now?: () => number;
}

interface RecordingRow {
  readonly id: string;
  readonly schema_version: number;
  readonly file_path: string;
  readonly title: string;
  readonly created_at: number;
  readonly duration_ms: number;
  readonly width: number;
  readonly height: number;
  readonly frame_rate: number;
  readonly profile_id: string;
  readonly codec: string;
  readonly has_system_audio: number;
  readonly has_microphone: number;
  readonly file_size_bytes: number;
  readonly availability: string;
  readonly failure_reason: string | null;
  readonly failure_occurred_at: number | null;
  readonly failure_recoverable: number | null;
  readonly recovered_at: number | null;
  readonly original_file_path: string | null;
}

class UnsupportedMetadataSchemaError extends Error {}

interface RecordingCatalogMigration {
  readonly toVersion: number;
  apply(database: DatabaseSync): void;
}

const recordingCatalogMigrations: readonly RecordingCatalogMigration[] = [
  {
    toVersion: 1,
    apply(database) {
      database.exec(`
        CREATE TABLE recordings (
          id TEXT PRIMARY KEY NOT NULL,
          schema_version INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at REAL NOT NULL,
          duration_ms REAL NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          frame_rate INTEGER NOT NULL,
          profile_id TEXT NOT NULL,
          codec TEXT NOT NULL,
          has_system_audio INTEGER NOT NULL,
          has_microphone INTEGER NOT NULL,
          file_size_bytes REAL NOT NULL,
          availability TEXT NOT NULL,
          failure_reason TEXT,
          failure_occurred_at REAL,
          failure_recoverable INTEGER,
          recovered_at REAL,
          original_file_path TEXT
        ) STRICT;
        CREATE INDEX recordings_created_at_idx ON recordings(created_at DESC);
      `);
    },
  },
];

/** SQLite owns only metadata; recordings remain regular user-visible media files. */
export class SqliteRecordingCatalog implements RecordingCatalogRepository {
  private readonly database: DatabaseSync;
  private readonly logger: Logger;

  public constructor(options: SqliteRecordingCatalogOptions) {
    this.logger = options.logger;
    mkdirSync(path.dirname(options.databasePath), { recursive: true });
    this.database = this.openSafely(options.databasePath, options.now ?? Date.now);
  }

  public async list(): Promise<readonly RecordingMetadata[]> {
    const rows = this.database
      .prepare('SELECT * FROM recordings ORDER BY created_at DESC')
      .all() as unknown as RecordingRow[];
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  public async findById(id: string): Promise<RecordingMetadata | undefined> {
    const row = this.database.prepare('SELECT * FROM recordings WHERE id = ?').get(id) as
      RecordingRow | undefined;
    return row === undefined ? undefined : this.hydrate(row);
  }

  public save(recording: RecordingMetadata): Promise<void> {
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO recordings (
            id, schema_version, file_path, title, created_at, duration_ms, width, height,
            frame_rate, profile_id, codec, has_system_audio, has_microphone, file_size_bytes,
            availability, failure_reason, failure_occurred_at, failure_recoverable,
            recovered_at, original_file_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            schema_version = excluded.schema_version,
            file_path = excluded.file_path,
            title = excluded.title,
            created_at = excluded.created_at,
            duration_ms = excluded.duration_ms,
            width = excluded.width,
            height = excluded.height,
            frame_rate = excluded.frame_rate,
            profile_id = excluded.profile_id,
            codec = excluded.codec,
            has_system_audio = excluded.has_system_audio,
            has_microphone = excluded.has_microphone,
            file_size_bytes = excluded.file_size_bytes,
            availability = excluded.availability,
            failure_reason = excluded.failure_reason,
            failure_occurred_at = excluded.failure_occurred_at,
            failure_recoverable = excluded.failure_recoverable,
            recovered_at = excluded.recovered_at,
            original_file_path = excluded.original_file_path`,
        )
        .run(
          recording.id,
          recording.schemaVersion,
          recording.filePath,
          recording.title,
          recording.createdAt,
          recording.durationMs,
          recording.width,
          recording.height,
          recording.frameRate,
          recording.profileId,
          recording.codec,
          Number(recording.hasSystemAudio),
          Number(recording.hasMicrophone),
          recording.fileSizeBytes,
          recording.availability,
          recording.failure?.reason ?? null,
          recording.failure?.occurredAt ?? null,
          recording.failure === undefined ? null : Number(recording.failure.recoverable),
          recording.recovery?.recoveredAt ?? null,
          recording.recovery?.originalFilePath ?? null,
        );
    });
    return Promise.resolve();
  }

  public remove(id: string): Promise<void> {
    this.transaction(() => {
      this.database.prepare('DELETE FROM recordings WHERE id = ?').run(id);
    });
    return Promise.resolve();
  }

  public dispose(): void {
    this.database.close();
  }

  private async hydrate(row: RecordingRow): Promise<RecordingMetadata> {
    const availability: RecordingAvailability = await access(row.file_path)
      .then(() => 'available' as const)
      .catch(() => 'missing' as const);

    if (availability !== row.availability) {
      this.database
        .prepare('UPDATE recordings SET availability = ? WHERE id = ?')
        .run(availability, row.id);
    }

    return createRecordingMetadata({
      schemaVersion: this.requireSchemaVersion(row.schema_version),
      id: row.id,
      filePath: createRecordingFilePath(row.file_path),
      title: row.title,
      createdAt: row.created_at,
      durationMs: createDurationMs(row.duration_ms),
      width: row.width,
      height: row.height,
      frameRate: this.requireFrameRate(row.frame_rate),
      profileId: this.requireProfile(row.profile_id),
      codec: this.requireCodec(row.codec),
      hasSystemAudio: row.has_system_audio === 1,
      hasMicrophone: row.has_microphone === 1,
      fileSizeBytes: row.file_size_bytes,
      availability,
      failure:
        row.failure_reason === null || row.failure_occurred_at === null
          ? undefined
          : {
              reason: row.failure_reason,
              occurredAt: row.failure_occurred_at,
              recoverable: row.failure_recoverable === 1,
            },
      recovery:
        row.recovered_at === null || row.original_file_path === null
          ? undefined
          : {
              recoveredAt: row.recovered_at,
              originalFilePath: createRecordingFilePath(row.original_file_path),
            },
    });
  }

  private openSafely(databasePath: string, now: () => number): DatabaseSync {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath);
      this.configure(database);
      this.verifyIntegrity(database);
      this.migrate(database);
      return database;
    } catch (error) {
      database?.close();
      if (error instanceof UnsupportedMetadataSchemaError) throw error;

      this.quarantineCorruptDatabase(databasePath, now());
      this.logger.warn('The recording catalog was corrupt and has been safely rebuilt.');
      const replacement = new DatabaseSync(databasePath);
      this.configure(replacement);
      this.migrate(replacement);
      return replacement;
    }
  }

  private configure(database: DatabaseSync): void {
    database.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 3000;',
    );
  }

  private verifyIntegrity(database: DatabaseSync): void {
    const result = database.prepare('PRAGMA quick_check').get() as
      Record<string, string> | undefined;
    if (result === undefined || Object.values(result)[0] !== 'ok') {
      throw new Error('Recording catalog integrity check failed.');
    }
  }

  private migrate(database: DatabaseSync): void {
    const result = database.prepare('PRAGMA user_version').get() as
      Record<string, number> | undefined;
    const version = result === undefined ? 0 : (Object.values(result)[0] ?? 0);

    if (version > recordingMetadataSchemaVersion) {
      throw new UnsupportedMetadataSchemaError('The recording catalog was created by a newer app.');
    }

    let migratedVersion = version;
    for (const migration of recordingCatalogMigrations) {
      if (migration.toVersion <= migratedVersion) continue;
      if (migration.toVersion !== migratedVersion + 1) {
        throw new Error(`Recording catalog migration ${migratedVersion + 1} is missing.`);
      }

      database.exec('BEGIN IMMEDIATE');
      try {
        migration.apply(database);
        database.exec(`PRAGMA user_version = ${migration.toVersion}`);
        database.exec('COMMIT');
        migratedVersion = migration.toVersion;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }

    if (migratedVersion !== recordingMetadataSchemaVersion) {
      throw new Error(
        `Recording catalog migration ended at ${migratedVersion}, expected ${recordingMetadataSchemaVersion}.`,
      );
    }
  }

  private quarantineCorruptDatabase(databasePath: string, timestamp: number): void {
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${databasePath}${suffix}`;
      if (existsSync(source)) renameSync(source, `${databasePath}.corrupt-${timestamp}${suffix}`);
    }
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private requireSchemaVersion(value: number): typeof recordingMetadataSchemaVersion {
    if (value !== recordingMetadataSchemaVersion) {
      throw new UnsupportedMetadataSchemaError('A recording has unsupported metadata.');
    }
    return value;
  }

  private requireFrameRate(value: number): 30 | 60 {
    if (value !== 30 && value !== 60) throw new Error('Recording frame rate is invalid.');
    return value;
  }

  private requireProfile(value: string): RecordingProfileId {
    if (value !== 'compatible' && value !== 'balanced' && value !== 'master') {
      throw new Error('Recording profile is invalid.');
    }
    return value;
  }

  private requireCodec(value: string): RecordingCodec {
    if (value !== 'h264' && value !== 'hevc' && value !== 'prores422') {
      throw new Error('Recording codec is invalid.');
    }
    return value;
  }
}
