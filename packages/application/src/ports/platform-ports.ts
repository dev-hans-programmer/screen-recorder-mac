import type {
  RecordingDiagnostics,
  RecordingFilePath,
  RecordingMetadata,
} from '@screen-recorder/domain';

export interface FileSystemPort {
  ensureDirectory(path: string): Promise<void>;
  getAvailableBytes(path: string): Promise<number>;
  fileExists(path: string): Promise<boolean>;
}

export interface RecordingFileActionsPort {
  rename(filePath: RecordingFilePath, title: string): Promise<RecordingFilePath>;
  moveToTrash(filePath: RecordingFilePath): Promise<void>;
  open(filePath: RecordingFilePath): Promise<void>;
  reveal(filePath: RecordingFilePath): Promise<void>;
  openDirectory(directoryPath: string): Promise<void>;
}

export interface RecordingThumbnailPort {
  getDataUrl(recording: RecordingMetadata): Promise<string | undefined>;
  storeFromFile(recording: RecordingMetadata, sourcePath: string): Promise<void>;
  remove(recordingId: string): Promise<void>;
}

/** Creates a renderer-compatible, disposable editing proxy without changing the source media. */
export interface RecordingPreviewPort {
  prepare(recording: RecordingMetadata): Promise<RecordingFilePath>;
  remove(recordingId: string): Promise<void>;
}

export type PermissionSettingsTarget = 'screen-recording' | 'microphone';

export interface SystemSettingsPort {
  openPermissionSettings(target: PermissionSettingsTarget): Promise<void>;
}

export interface DiagnosticsReportPort {
  exportReport(recordings: readonly RecordingDiagnostics[]): Promise<string | undefined>;
}

/** Opens the platform-native folder chooser without exposing filesystem APIs to the renderer. */
export interface RecordingDirectoryPickerPort {
  selectDirectory(defaultPath: string): Promise<string | undefined>;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}
