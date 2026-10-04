import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import os from 'node:os';

import { app, dialog } from 'electron';
import { version as reactVersion } from 'react';
import type { DiagnosticsReportPort } from '@screen-recorder/application';
import type { RecordingDiagnostics } from '@screen-recorder/domain';

import { appMetadata } from '../../shared/app-metadata';
import { nativeProtocolVersion } from './native/native-service-protocol';
import type { StructuredFileLogger } from './logger';

interface ElectronDiagnosticsReportOptions {
  readonly logger: Pick<StructuredFileLogger, 'readRecentErrors'>;
  readonly now?: () => number;
  readonly getNativeServiceVersion?: () => string | undefined;
}

export class ElectronDiagnosticsReport implements DiagnosticsReportPort {
  private readonly logger: Pick<StructuredFileLogger, 'readRecentErrors'>;
  private readonly now: () => number;
  private readonly getNativeServiceVersion: () => string | undefined;

  public constructor(options: ElectronDiagnosticsReportOptions) {
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.getNativeServiceVersion = options.getNativeServiceVersion ?? (() => undefined);
  }

  public async exportReport(
    recordings: readonly RecordingDiagnostics[],
  ): Promise<string | undefined> {
    const generatedAt = new Date(this.now());
    const result = await dialog.showSaveDialog({
      title: 'Export Screen Recorder diagnostics',
      defaultPath: `screen-recorder-diagnostics-${generatedAt.toISOString().slice(0, 10)}.json`,
      buttonLabel: 'Export diagnostics',
      filters: [{ name: 'JSON report', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || result.filePath === undefined) return undefined;

    const processor = os.cpus()[0];
    const report = {
      reportVersion: 2,
      generatedAt: generatedAt.toISOString(),
      privacy: {
        includesRecordingContent: false,
        includesRecordingFilePaths: false,
        includesUserName: false,
      },
      application: {
        name: app.getName(),
        version: app.getVersion(),
      },
      runtimes: {
        electronVersion: process.versions.electron ?? 'unknown',
        nodeVersion: process.versions.node,
        reactVersion,
      },
      nativeService: {
        expectedVersion: appMetadata.nativeServiceVersion,
        observedVersion: this.getNativeServiceVersion() ?? 'not-started',
        protocolVersion: nativeProtocolVersion,
      },
      system: {
        operatingSystem: 'macOS',
        version: systemVersion(),
        architecture: process.arch,
        cpuModel: processor?.model ?? 'Unknown',
        logicalCpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
      },
      recentErrors: await this.logger.readRecentErrors(50),
      recentRecordings: recordings,
    };

    await writePrivateJson(result.filePath, report);
    return result.filePath;
  }
}

function systemVersion(): string {
  const electronProcess = process as NodeJS.Process & { getSystemVersion?: () => string };
  return electronProcess.getSystemVersion?.() ?? os.release();
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const file = await open(temporaryPath, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await file.sync();
    await file.close();
    await rename(temporaryPath, filePath);
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
