import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EditingProjectRepository } from '@screen-recorder/application';
import { editingProjectSchema } from '@screen-recorder/contracts';
import type { EditingProject } from '@screen-recorder/domain';

export class JsonEditingProjectRepository implements EditingProjectRepository {
  public constructor(private readonly directory: string) {}

  public async findByRecordingId(recordingId: string): Promise<EditingProject | undefined> {
    try {
      const value = JSON.parse(await readFile(this.filePath(recordingId), 'utf8')) as unknown;
      const result = editingProjectSchema.safeParse(value);
      if (!result.success) {
        throw new Error(`Saved editing project is invalid: ${result.error.message}`);
      }
      return result.data;
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  public async save(project: EditingProject): Promise<void> {
    const result = editingProjectSchema.safeParse(project);
    if (!result.success) throw new Error(`Editing project is invalid: ${result.error.message}`);
    await mkdir(this.directory, { recursive: true });
    const target = this.filePath(project.recordingId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(result.data, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private filePath(recordingId: string): string {
    const safeId = createHash('sha256').update(recordingId).digest('hex');
    return path.join(this.directory, `${safeId}.json`);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
