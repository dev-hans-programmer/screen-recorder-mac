import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { nativeImage, type NativeImage } from 'electron';
import type { RecordingMetadata } from '@screen-recorder/domain';
import type { RecordingThumbnailPort } from '@screen-recorder/application';

interface ThumbnailImageApi {
  createFromBuffer(buffer: Buffer): NativeImage;
  createThumbnailFromPath(
    filePath: string,
    size: { width: number; height: number },
  ): Promise<NativeImage>;
}

export class RecordingThumbnailService implements RecordingThumbnailPort {
  private readonly inFlight = new Map<string, Promise<string | undefined>>();

  public constructor(
    private readonly cacheDirectory: string,
    private readonly images: ThumbnailImageApi = nativeImage,
  ) {}

  public getDataUrl(recording: RecordingMetadata): Promise<string | undefined> {
    const existing = this.inFlight.get(recording.id);
    if (existing !== undefined) return existing;

    const pending = this.loadOrCreate(recording).finally(() => this.inFlight.delete(recording.id));
    this.inFlight.set(recording.id, pending);
    return pending;
  }

  public async remove(recordingId: string): Promise<void> {
    await mkdir(this.cacheDirectory, { recursive: true });
    const prefix = `${this.idKey(recordingId)}-`;
    const files = await readdir(this.cacheDirectory);
    await Promise.all(
      files
        .filter((fileName) => fileName.startsWith(prefix))
        .map((fileName) => rm(path.join(this.cacheDirectory, fileName), { force: true })),
    );
  }

  public async storeFromFile(recording: RecordingMetadata, sourcePath: string): Promise<void> {
    await mkdir(this.cacheDirectory, { recursive: true });
    const cachePath = this.cachePath(recording);
    const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
    try {
      const sourceImage = this.images.createFromBuffer(await readFile(sourcePath));
      if (sourceImage.isEmpty()) throw new Error('The selected poster frame is not a valid image.');
      await copyFile(sourcePath, temporaryPath);
      await rename(temporaryPath, cachePath);
    } finally {
      // Poster files are staging artifacts owned by this service, including failure paths.
      await rm(temporaryPath, { force: true });
      await rm(sourcePath, { force: true });
    }
  }

  private async loadOrCreate(recording: RecordingMetadata): Promise<string | undefined> {
    await mkdir(this.cacheDirectory, { recursive: true });
    const cachePath = this.cachePath(recording);

    try {
      const cached = this.images.createFromBuffer(await readFile(cachePath));
      if (!cached.isEmpty()) return cached.toDataURL();
    } catch {
      // Cache misses and invalid cache files both regenerate from the source recording.
    }

    const thumbnail = await this.images.createThumbnailFromPath(recording.filePath, {
      width: 640,
      height: 360,
    });
    if (thumbnail.isEmpty()) return undefined;

    const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, thumbnail.toPNG());
    await rename(temporaryPath, cachePath);
    return thumbnail.toDataURL();
  }

  private cachePath(recording: RecordingMetadata): string {
    const fingerprint = createHash('sha256')
      .update(`${recording.id}:${recording.createdAt}:${recording.fileSizeBytes}`)
      .digest('hex')
      .slice(0, 20);
    return path.join(this.cacheDirectory, `${this.idKey(recording.id)}-${fingerprint}.png`);
  }

  private idKey(recordingId: string): string {
    return createHash('sha256').update(recordingId).digest('hex').slice(0, 20);
  }
}
