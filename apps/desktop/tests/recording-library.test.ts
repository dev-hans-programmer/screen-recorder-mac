import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const imageMocks = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
  createThumbnailFromPath: vi.fn(),
}));
const shellMocks = vi.hoisted(() => ({
  openPath: vi.fn(async () => ''),
  showItemInFolder: vi.fn(),
  trashItem: vi.fn(async () => undefined),
}));

vi.mock('electron', () => ({ nativeImage: imageMocks, shell: shellMocks }));

import {
  createDurationMs,
  createRecordingArtifact,
  createRecordingFilePath,
  createRecordingMetadata,
  createRecordingMetadataFromArtifact,
} from '@screen-recorder/domain';

import { SqliteRecordingCatalog } from '../src/main/infrastructure/sqlite-recording-catalog';
import { RecordingThumbnailService } from '../src/main/infrastructure/recording-thumbnail-service';
import { ElectronRecordingFileActions } from '../src/main/infrastructure/recording-file-actions';

const temporaryDirectories: string[] = [];

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'screen-recorder-library-'));
  temporaryDirectories.push(directory);
  return directory;
}

function artifact(filePath: string) {
  return createRecordingArtifact({
    id: 'recording-1',
    filePath: createRecordingFilePath(filePath),
    title: 'Product demo',
    createdAt: 1_000,
    durationMs: createDurationMs(5_000),
    width: 1920,
    height: 1080,
    frameRate: 60,
    profileId: 'balanced',
    codec: 'hevc',
    hasSystemAudio: true,
    hasMicrophone: false,
    fileSizeBytes: 8_192,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.clearAllMocks();
});

describe('SQLite recording catalog', () => {
  it('persists versioned metadata and refreshes missing-file state across restarts', async () => {
    const directory = await temporaryDirectory();
    const mediaPath = path.join(directory, 'product-demo.mp4');
    const databasePath = path.join(directory, 'metadata', 'recordings.sqlite3');
    await writeFile(mediaPath, 'small test fixture');
    const first = new SqliteRecordingCatalog({ databasePath, logger });
    const metadata = createRecordingMetadata({
      ...createRecordingMetadataFromArtifact(artifact(mediaPath)),
      failure: { reason: 'Interrupted once', occurredAt: 900, recoverable: true },
      recovery: {
        recoveredAt: 950,
        originalFilePath: createRecordingFilePath(`${mediaPath}.partial`),
      },
    });

    await first.save(metadata);
    first.dispose();

    const reopened = new SqliteRecordingCatalog({ databasePath, logger });
    await expect(reopened.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'recording-1',
        schemaVersion: 1,
        codec: 'hevc',
        availability: 'available',
        failure: expect.objectContaining({ recoverable: true }),
        recovery: expect.objectContaining({ recoveredAt: 950 }),
      }),
    ]);

    await unlink(mediaPath);
    await expect(reopened.findById('recording-1')).resolves.toMatchObject({
      availability: 'missing',
    });
    reopened.dispose();
  });

  it('quarantines a corrupt catalog and starts with a safe empty replacement', async () => {
    const directory = await temporaryDirectory();
    const databasePath = path.join(directory, 'recordings.sqlite3');
    await writeFile(databasePath, 'not a sqlite database');

    const catalog = new SqliteRecordingCatalog({ databasePath, logger, now: () => 42 });

    await expect(catalog.list()).resolves.toEqual([]);
    expect(await readdir(directory)).toContain('recordings.sqlite3.corrupt-42');
    expect(logger.warn).toHaveBeenCalledOnce();
    catalog.dispose();
  });
});

describe('recording thumbnail cache', () => {
  it('generates once off the renderer path and then serves the cached PNG', async () => {
    const directory = await temporaryDirectory();
    const cacheDirectory = path.join(directory, 'thumbnails');
    const image = {
      isEmpty: () => false,
      toDataURL: () => 'data:image/png;base64,dGh1bWI=',
      toPNG: () => Buffer.from('cached thumbnail'),
    };
    imageMocks.createThumbnailFromPath.mockResolvedValue(image);
    imageMocks.createFromBuffer.mockReturnValue(image);
    const service = new RecordingThumbnailService(cacheDirectory, imageMocks as never);
    const metadata = createRecordingMetadataFromArtifact(
      artifact(path.join(directory, 'product-demo.mp4')),
    );

    await expect(service.getDataUrl(metadata)).resolves.toBe('data:image/png;base64,dGh1bWI=');
    await expect(service.getDataUrl(metadata)).resolves.toBe('data:image/png;base64,dGh1bWI=');

    expect(imageMocks.createThumbnailFromPath).toHaveBeenCalledTimes(1);
    expect(imageMocks.createThumbnailFromPath).toHaveBeenCalledWith(metadata.filePath, {
      width: 640,
      height: 360,
    });
    expect(imageMocks.createFromBuffer).toHaveBeenCalledTimes(1);

    await service.remove(metadata.id);
    expect(await readdir(cacheDirectory)).toEqual([]);
  });
});

describe('recording file actions', () => {
  it('renames media without changing its extension and delegates safe desktop actions', async () => {
    const directory = await temporaryDirectory();
    const sourcePath = path.join(directory, 'old-name.mp4');
    await writeFile(sourcePath, 'recording');
    const actions = new ElectronRecordingFileActions();

    const renamedPath = await actions.rename(
      createRecordingFilePath(sourcePath),
      'Product walkthrough',
    );
    await actions.open(renamedPath);
    await actions.reveal(renamedPath);
    await actions.moveToTrash(renamedPath);

    expect(renamedPath).toBe(path.join(directory, 'Product walkthrough.mp4'));
    expect(shellMocks.openPath).toHaveBeenCalledWith(renamedPath);
    expect(shellMocks.showItemInFolder).toHaveBeenCalledWith(renamedPath);
    expect(shellMocks.trashItem).toHaveBeenCalledWith(renamedPath);
  });
});
