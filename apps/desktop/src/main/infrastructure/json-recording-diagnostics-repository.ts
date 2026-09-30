import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Logger, RecordingDiagnosticsRepository } from '@screen-recorder/application';
import {
  createRecordingDiagnostics,
  type AudioTrackState,
  type EncoderKind,
  type RecordingCodec,
  type RecordingDiagnostics,
} from '@screen-recorder/domain';

interface JsonRecordingDiagnosticsRepositoryOptions {
  readonly filePath: string;
  readonly logger: Logger;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

const diagnosticsSchemaVersion = 1 as const;

/** Small bounded history used for support reports; it intentionally contains no media paths. */
export class JsonRecordingDiagnosticsRepository implements RecordingDiagnosticsRepository {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private current: readonly RecordingDiagnostics[] | undefined;
  private loadPromise: Promise<readonly RecordingDiagnostics[]> | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(options: JsonRecordingDiagnosticsRepositoryOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger;
    this.maxEntries = Math.max(1, options.maxEntries ?? 50);
    this.now = options.now ?? Date.now;
  }

  public async listRecent(limit: number): Promise<readonly RecordingDiagnostics[]> {
    const diagnostics = await this.getAll();
    return diagnostics.slice(0, Math.max(0, Math.floor(limit)));
  }

  public async save(diagnostics: RecordingDiagnostics): Promise<void> {
    const validated = createRecordingDiagnostics(diagnostics);
    const write = this.writeChain.then(async () => {
      const current = await this.getAll();
      const next = Object.freeze(
        [validated, ...current.filter((entry) => entry.sessionId !== validated.sessionId)].slice(
          0,
          this.maxEntries,
        ),
      );
      await this.writeAtomically(next);
      this.current = next;
    });
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  private getAll(): Promise<readonly RecordingDiagnostics[]> {
    if (this.current !== undefined) return Promise.resolve(this.current);
    this.loadPromise ??= this.load();
    return this.loadPromise;
  }

  private async load(): Promise<readonly RecordingDiagnostics[]> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        typeof raw !== 'object' ||
        raw === null ||
        !('schemaVersion' in raw) ||
        raw.schemaVersion !== diagnosticsSchemaVersion ||
        !('recordings' in raw) ||
        !Array.isArray(raw.recordings)
      ) {
        throw new Error('The recording diagnostics envelope is invalid.');
      }

      this.current = Object.freeze(
        raw.recordings.slice(0, this.maxEntries).map(parseRecordingDiagnostics),
      );
      return this.current;
    } catch (error) {
      if (isMissingFile(error)) {
        this.current = Object.freeze([]);
        return this.current;
      }

      await this.quarantineCorruptFile();
      this.logger.warn('Saved recording diagnostics were invalid and have been quarantined.');
      this.current = Object.freeze([]);
      return this.current;
    }
  }

  private async writeAtomically(recordings: readonly RecordingDiagnostics[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    const file = await open(temporaryPath, 'wx', 0o600);

    try {
      await file.writeFile(
        `${JSON.stringify({ schemaVersion: diagnosticsSchemaVersion, recordings })}\n`,
        'utf8',
      );
      await file.sync();
      await file.close();
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await file.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async quarantineCorruptFile(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${this.now()}`);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
}

function parseRecordingDiagnostics(value: unknown): RecordingDiagnostics {
  if (typeof value !== 'object' || value === null) {
    throw new Error('A recording diagnostic entry was invalid.');
  }
  const entry = value as Record<string, unknown>;
  if (entry.schemaVersion !== 1) {
    throw new Error('A recording diagnostic entry used an unsupported schema version.');
  }
  return createRecordingDiagnostics({
    schemaVersion: 1,
    sessionId: stringValue(entry.sessionId),
    recordedAt: numberValue(entry.recordedAt),
    width: numberValue(entry.width),
    height: numberValue(entry.height),
    durationMs: numberValue(entry.durationMs),
    capturedFrameCount: numberValue(entry.capturedFrameCount),
    actualFrameCount: numberValue(entry.actualFrameCount),
    droppedFrameCount: numberValue(entry.droppedFrameCount),
    codec: stringValue(entry.codec) as RecordingCodec,
    encoder: stringValue(entry.encoder) as EncoderKind,
    systemAudio: stringValue(entry.systemAudio) as AudioTrackState,
    microphone: stringValue(entry.microphone) as AudioTrackState,
    fileSizeBytes: numberValue(entry.fileSizeBytes),
    averageFileWriteBytesPerSecond: numberValue(entry.averageFileWriteBytesPerSecond),
    peakFileWriteBytesPerSecond: numberValue(entry.peakFileWriteBytesPerSecond),
  });
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string diagnostic field.');
  return value;
}

function numberValue(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Expected a numeric diagnostic field.');
  return value;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
