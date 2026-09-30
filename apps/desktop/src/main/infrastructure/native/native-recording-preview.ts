import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';

import type { RecordingPreviewPort } from '@screen-recorder/application';
import {
  createRecordingFilePath,
  DomainError,
  type RecordingFilePath,
  type RecordingMetadata,
} from '@screen-recorder/domain';

import { parseNativeRecordingPreviewResult, toNativeDomainError } from './native-mappers';
import { NativeServiceSupervisor } from './native-service-supervisor';

const previewTimeoutMs = 60 * 60 * 1_000;

/** Maintains fingerprinted H.264 proxies for codecs Chromium cannot reliably decode. */
export class NativeRecordingPreview implements RecordingPreviewPort {
  private readonly pending = new Map<string, Promise<RecordingFilePath>>();

  public constructor(
    private readonly supervisor: NativeServiceSupervisor,
    private readonly cacheDirectory: string,
  ) {}

  public prepare(recording: RecordingMetadata): Promise<RecordingFilePath> {
    const active = this.pending.get(recording.id);
    if (active !== undefined) return active;

    const preparation = this.prepareUncached(recording).finally(() => {
      this.pending.delete(recording.id);
    });
    this.pending.set(recording.id, preparation);
    return preparation;
  }

  public async remove(recordingId: string): Promise<void> {
    const prefix = `${safeId(recordingId)}-`;
    const entries = await readdir(this.cacheDirectory).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.mp4'))
        .map((entry) => unlink(path.join(this.cacheDirectory, entry)).catch(() => undefined)),
    );
  }

  private async prepareUncached(recording: RecordingMetadata): Promise<RecordingFilePath> {
    if (recording.codec === 'h264') return recording.filePath;

    const source = await stat(recording.filePath);
    const fingerprint = createHash('sha256')
      .update(`${recording.filePath}:${source.size}:${source.mtimeMs}`)
      .digest('hex')
      .slice(0, 16);
    const outputPath = path.join(this.cacheDirectory, `${safeId(recording.id)}-${fingerprint}.mp4`);
    const cached = await stat(outputPath).catch(() => undefined);
    if (cached !== undefined && cached.size > 0) return createRecordingFilePath(outputPath);

    await mkdir(this.cacheDirectory, { recursive: true });
    const operationId = `preview:${recording.id}`;
    this.supervisor.reserveEditor(operationId);
    try {
      const result = parseNativeRecordingPreviewResult(
        await this.supervisor.request(
          'prepareRecordingPreview',
          { inputPath: recording.filePath, outputPath },
          { timeoutMs: previewTimeoutMs },
        ),
      );
      if (
        result.status !== 'completed' ||
        path.resolve(result.filePath) !== path.resolve(outputPath)
      ) {
        throw new DomainError('NATIVE_SERVICE_FAILURE', 'Native preview output was invalid.');
      }
      await this.removeObsolete(recording.id, path.basename(outputPath));
      return createRecordingFilePath(outputPath);
    } catch (error) {
      await unlink(outputPath).catch(() => undefined);
      throw toNativeDomainError(error);
    } finally {
      this.supervisor.releaseEditor(operationId);
    }
  }

  private async removeObsolete(recordingId: string, currentFile: string): Promise<void> {
    const prefix = `${safeId(recordingId)}-`;
    const entries = await readdir(this.cacheDirectory).catch(() => []);
    await Promise.all(
      entries
        .filter(
          (entry) => entry !== currentFile && entry.startsWith(prefix) && entry.endsWith('.mp4'),
        )
        .map((entry) => unlink(path.join(this.cacheDirectory, entry)).catch(() => undefined)),
    );
  }
}

function safeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}
