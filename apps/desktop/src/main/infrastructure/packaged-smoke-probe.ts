import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createRecordingRequest } from '@screen-recorder/domain';
import type { BrowserWindow } from 'electron';

import type { ApplicationContainer } from '../application/composition-root';

interface PackagedSmokeReport {
  readonly schemaVersion: 1;
  readonly rendererLoaded: boolean;
  readonly helperDiscovered: boolean;
  readonly sourceCount: number;
  readonly recordingRequested: boolean;
  readonly recordingCompleted: boolean;
  readonly outputPath?: string;
  readonly outputSizeBytes?: number;
  readonly error?: string;
}

export interface PackagedSmokeProbeOptions {
  readonly record: boolean;
  readonly window: BrowserWindow;
  readonly container: ApplicationContainer;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function runPackagedSmokeProbe(
  options: PackagedSmokeProbeOptions,
): Promise<PackagedSmokeReport> {
  let rendererLoaded = false;
  let helperDiscovered = false;
  let sourceCount = 0;

  try {
    rendererLoaded =
      (await options.window.webContents.executeJavaScript('document.readyState')) === 'complete';
    await options.container.capture.getCapabilities();
    helperDiscovered = true;
    const sources = await options.container.capture.listSources();
    sourceCount = sources.length;

    let outputPath: string | undefined;
    let outputSizeBytes: number | undefined;
    if (options.record) {
      const source = sources.find(
        (candidate) => candidate.kind === 'display' && candidate.isAvailable,
      );
      if (source === undefined) throw new Error('No available display source was discovered.');

      const started = await options.container.useCases.startRecording.execute(
        createRecordingRequest({
          source,
          region: undefined,
          profileId: 'compatible',
          resolution: '1080p',
          frameRate: 30,
          audio: { systemAudio: false, microphone: false },
          showsCursor: true,
          showsMouseClicks: false,
        }),
      );
      await wait(2_000);
      const artifact = await options.container.useCases.stopRecording.execute(started.session.id);
      outputPath = artifact.filePath;
      outputSizeBytes = (await stat(outputPath)).size;
    }

    return {
      schemaVersion: 1,
      rendererLoaded,
      helperDiscovered,
      sourceCount,
      recordingRequested: options.record,
      recordingCompleted: options.record && outputSizeBytes !== undefined && outputSizeBytes > 0,
      ...(outputPath === undefined ? {} : { outputPath }),
      ...(outputSizeBytes === undefined ? {} : { outputSizeBytes }),
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      rendererLoaded,
      helperDiscovered,
      sourceCount,
      recordingRequested: options.record,
      recordingCompleted: false,
      error: error instanceof Error ? error.message : 'Packaged smoke probe failed.',
    };
  }
}

export async function writePackagedSmokeReport(
  reportPath: string,
  report: PackagedSmokeReport,
): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
