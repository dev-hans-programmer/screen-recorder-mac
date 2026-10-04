import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  getName: vi.fn(() => 'Screen Recorder'),
  getVersion: vi.fn(() => '0.1.0'),
}));

vi.mock('electron', () => ({
  app: { getName: electronMocks.getName, getVersion: electronMocks.getVersion },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
}));

import { createRecordingDiagnostics, type RecordingDiagnostics } from '@screen-recorder/domain';

import { ElectronDiagnosticsReport } from '../src/main/infrastructure/electron-diagnostics-report';
import { JsonRecordingDiagnosticsRepository } from '../src/main/infrastructure/json-recording-diagnostics-repository';
import { StructuredFileLogger } from '../src/main/infrastructure/logger';

const temporaryDirectories: string[] = [];
const loggerStub = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'screen-recorder-diagnostics-'));
  temporaryDirectories.push(directory);
  return directory;
}

function recordingDiagnostics(sessionId = 'session-1'): RecordingDiagnostics {
  return createRecordingDiagnostics({
    schemaVersion: 1,
    sessionId,
    recordedAt: 1_000,
    width: 3840,
    height: 2160,
    durationMs: 10_000,
    capturedFrameCount: 598,
    actualFrameCount: 596,
    droppedFrameCount: 2,
    codec: 'hevc',
    encoder: 'hardware',
    systemAudio: 'active',
    microphone: 'disabled',
    fileSizeBytes: 20_000_000,
    averageFileWriteBytesPerSecond: 2_000_000,
    peakFileWriteBytesPerSecond: 3_200_000,
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

describe('structured logging', () => {
  it('redacts sensitive paths, rotates bounded files, and returns recent errors', async () => {
    const directory = await temporaryDirectory();
    let now = 1_000;
    const logger = new StructuredFileLogger({
      directory,
      minimumLevel: 'debug',
      maxFileBytes: 512,
      maxFiles: 3,
      now: () => now++,
    });

    for (let index = 0; index < 20; index += 1) {
      logger.info(`Lifecycle checkpoint ${index}`, { payload: 'x'.repeat(80) });
    }
    logger.error('Writer failed at /Users/example/Movies/private-capture.mp4', {
      filePath: '/Users/example/Movies/private-capture.mp4',
      nested: { outputDirectory: '/Users/example/Movies', code: 'WRITE_FAILED' },
    });
    await logger.flush();

    const files = await readdir(directory);
    const combined = (
      await Promise.all(files.map((file) => readFile(path.join(directory, file), 'utf8')))
    ).join('\n');
    const errors = await logger.readRecentErrors(10);

    expect(files.length).toBeLessThanOrEqual(3);
    expect(files).toContain('main.jsonl');
    expect(combined).not.toContain('/Users/example');
    expect(combined).not.toContain('private-capture.mp4');
    expect(combined).toContain('[redacted]');
    expect(errors.at(-1)).toMatchObject({ level: 'error' });
  });
});

describe('recording diagnostics repository', () => {
  it('persists a bounded, path-free performance history across restarts', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'recordings.json');
    const repository = new JsonRecordingDiagnosticsRepository({
      filePath,
      logger: loggerStub,
      maxEntries: 2,
    });
    await repository.save(recordingDiagnostics('session-1'));
    await repository.save(recordingDiagnostics('session-2'));
    await repository.save(recordingDiagnostics('session-3'));

    const reopened = new JsonRecordingDiagnosticsRepository({ filePath, logger: loggerStub });
    await expect(reopened.listRecent(10)).resolves.toMatchObject([
      { sessionId: 'session-3', actualFrameCount: 596 },
      { sessionId: 'session-2', actualFrameCount: 596 },
    ]);
    expect(await readFile(filePath, 'utf8')).not.toContain('.mp4');
  });
});

describe('diagnostics report export', () => {
  it('exports system details, recent errors, and path-free recording summaries', async () => {
    const directory = await temporaryDirectory();
    const reportPath = path.join(directory, 'support.json');
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: reportPath });
    const report = new ElectronDiagnosticsReport({
      logger: {
        readRecentErrors: async () => [
          { timestamp: '2026-09-30T00:00:00.000Z', level: 'error', message: 'Capture failed.' },
        ],
      },
      now: () => 1_798_588_800_000,
      getNativeServiceVersion: () => '0.1.3',
    });

    await expect(report.exportReport([recordingDiagnostics()])).resolves.toBe(reportPath);
    const exported = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    const serialized = JSON.stringify(exported);

    expect(exported).toMatchObject({
      reportVersion: 2,
      privacy: { includesRecordingContent: false, includesRecordingFilePaths: false },
      application: { name: 'Screen Recorder', version: '0.1.0' },
      runtimes: { reactVersion: '19.3.0' },
      nativeService: {
        expectedVersion: '0.1.3',
        observedVersion: '0.1.3',
        protocolVersion: 1,
      },
      system: { operatingSystem: 'macOS' },
    });
    expect(serialized).toContain('actualFrameCount');
    expect(serialized).not.toContain('.mp4');
    expect(serialized).not.toContain('/Users/');
  });
});
