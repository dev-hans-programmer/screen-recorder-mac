import { access, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

import { shell } from 'electron';
import {
  DomainError,
  createRecordingFilePath,
  type RecordingFilePath,
} from '@screen-recorder/domain';
import type { RecordingFileActionsPort } from '@screen-recorder/application';

export class ElectronRecordingFileActions implements RecordingFileActionsPort {
  public async rename(filePath: RecordingFilePath, title: string): Promise<RecordingFilePath> {
    const extension = path.extname(filePath);
    const nextPath = path.join(path.dirname(filePath), `${title}${extension}`);

    if (nextPath === filePath) return filePath;

    const targetExists = await access(nextPath)
      .then(() => true)
      .catch(() => false);
    if (targetExists) {
      throw new DomainError('INVALID_VALUE', 'A recording with that name already exists.');
    }

    await rename(filePath, nextPath);
    return createRecordingFilePath(nextPath);
  }

  public moveToTrash(filePath: RecordingFilePath): Promise<void> {
    return shell.trashItem(filePath);
  }

  public async open(filePath: RecordingFilePath): Promise<void> {
    const error = await shell.openPath(filePath);
    if (error.length > 0) throw new Error(`The recording could not be opened: ${error}`);
  }

  public reveal(filePath: RecordingFilePath): Promise<void> {
    shell.showItemInFolder(filePath);
    return Promise.resolve();
  }

  public async openDirectory(directoryPath: string): Promise<void> {
    await mkdir(directoryPath, { recursive: true });
    const error = await shell.openPath(directoryPath);
    if (error.length > 0) throw new Error(`The recordings folder could not be opened: ${error}`);
  }
}
