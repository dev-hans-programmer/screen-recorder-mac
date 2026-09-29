import { randomUUID } from 'node:crypto';

import {
  CheckCapturePermissionsUseCase,
  DeleteRecordingUseCase,
  GetRecordingThumbnailUseCase,
  GetPreferencesUseCase,
  ListCaptureSourcesUseCase,
  ListRecordingsUseCase,
  OpenRecordingUseCase,
  OpenRecordingsFolderUseCase,
  PauseRecordingUseCase,
  RecoverInterruptedRecordingUseCase,
  RequestCapturePermissionsUseCase,
  RenameRecordingUseCase,
  RevealRecordingUseCase,
  ResumeRecordingUseCase,
  StartRecordingUseCase,
  StopRecordingUseCase,
  UpdatePreferencesUseCase,
  ValidateRecordingRequestUseCase,
  type ApplicationEventPublisher,
  type CapturePort,
  type Clock,
  type IdGenerator,
  type Logger,
  type RecordingEnginePort,
} from '@screen-recorder/application';

import { createConsoleLogger } from '../infrastructure/logger';
import {
  InMemoryPreferencesRepository,
  InMemoryRecordingRepository,
} from '../infrastructure/in-memory-repositories';
import { ElectronRecordingFileActions } from '../infrastructure/recording-file-actions';
import { RecordingThumbnailService } from '../infrastructure/recording-thumbnail-service';
import { SqliteRecordingCatalog } from '../infrastructure/sqlite-recording-catalog';
import {
  NativeCapturePort,
  NativeRecordingEngine,
} from '../infrastructure/native/native-capture-adapter';
import { NativeServiceSupervisor } from '../infrastructure/native/native-service-supervisor';

class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }
}

class RandomIdGenerator implements IdGenerator {
  public next(): string {
    return randomUUID();
  }
}

export interface ApplicationContainer {
  readonly capture: CapturePort;
  readonly engine: RecordingEnginePort;
  readonly useCases: {
    readonly checkCapturePermissions: CheckCapturePermissionsUseCase;
    readonly deleteRecording: DeleteRecordingUseCase;
    readonly getPreferences: GetPreferencesUseCase;
    readonly getRecordingThumbnail: GetRecordingThumbnailUseCase;
    readonly listCaptureSources: ListCaptureSourcesUseCase;
    readonly listRecordings: ListRecordingsUseCase;
    readonly openRecording: OpenRecordingUseCase;
    readonly openRecordingsFolder: OpenRecordingsFolderUseCase;
    readonly pauseRecording: PauseRecordingUseCase;
    readonly recoverInterruptedRecording: RecoverInterruptedRecordingUseCase;
    readonly requestCapturePermissions: RequestCapturePermissionsUseCase;
    readonly renameRecording: RenameRecordingUseCase;
    readonly revealRecording: RevealRecordingUseCase;
    readonly resumeRecording: ResumeRecordingUseCase;
    readonly startRecording: StartRecordingUseCase;
    readonly stopRecording: StopRecordingUseCase;
    readonly updatePreferences: UpdatePreferencesUseCase;
    readonly validateRecordingRequest: ValidateRecordingRequestUseCase;
  };
  readonly logger: Logger;
  dispose(): Promise<void>;
}

export interface ApplicationContainerOptions {
  readonly nativeServicePath: string;
  readonly defaultOutputDirectory: () => string;
  readonly libraryDatabasePath: string;
  readonly thumbnailCacheDirectory: string;
}

export function createApplicationContainer(
  events: ApplicationEventPublisher,
  options: ApplicationContainerOptions,
  logger: Logger = createConsoleLogger(),
): ApplicationContainer {
  const sessions = new InMemoryRecordingRepository();
  const preferences = new InMemoryPreferencesRepository();
  const catalog = new SqliteRecordingCatalog({ databasePath: options.libraryDatabasePath, logger });
  const files = new ElectronRecordingFileActions();
  const thumbnails = new RecordingThumbnailService(options.thumbnailCacheDirectory);
  const clock = new SystemClock();
  const ids = new RandomIdGenerator();
  const supervisor = new NativeServiceSupervisor({
    executablePath: options.nativeServicePath,
    clientVersion: '0.1.0',
    onFailure: (failure) => {
      events.publish({
        version: 1,
        type: 'native-service.failed',
        sessionId: failure.sessionId,
        operation: failure.operation,
        message: failure.error.message,
        occurredAt: clock.now(),
      });
    },
    onLog: (message) => logger.debug('Native CaptureService output.', { message }),
  });
  const capture = new NativeCapturePort(supervisor);
  const engine = new NativeRecordingEngine({
    supervisor,
    clock,
    events,
    outputDirectory: async () => {
      const preferencesSnapshot = await preferences.get();
      return preferencesSnapshot.outputDirectory.trim() || options.defaultOutputDirectory();
    },
  });

  return {
    capture,
    engine,
    useCases: {
      checkCapturePermissions: new CheckCapturePermissionsUseCase(capture),
      deleteRecording: new DeleteRecordingUseCase(catalog, files, thumbnails),
      getPreferences: new GetPreferencesUseCase(preferences),
      getRecordingThumbnail: new GetRecordingThumbnailUseCase(catalog, thumbnails),
      listCaptureSources: new ListCaptureSourcesUseCase(capture),
      listRecordings: new ListRecordingsUseCase(catalog),
      openRecording: new OpenRecordingUseCase(catalog, files),
      openRecordingsFolder: new OpenRecordingsFolderUseCase(files, async () => {
        const savedDirectory = (await preferences.get()).outputDirectory.trim();
        return savedDirectory || options.defaultOutputDirectory();
      }),
      pauseRecording: new PauseRecordingUseCase(sessions, engine, clock, events),
      recoverInterruptedRecording: new RecoverInterruptedRecordingUseCase(sessions, clock, events),
      requestCapturePermissions: new RequestCapturePermissionsUseCase(capture),
      renameRecording: new RenameRecordingUseCase(catalog, files),
      revealRecording: new RevealRecordingUseCase(catalog, files),
      resumeRecording: new ResumeRecordingUseCase(sessions, engine, clock, events),
      startRecording: new StartRecordingUseCase({
        capture,
        engine,
        sessions,
        clock,
        ids,
        events,
      }),
      stopRecording: new StopRecordingUseCase(sessions, catalog, engine, clock, events),
      updatePreferences: new UpdatePreferencesUseCase(preferences),
      validateRecordingRequest: new ValidateRecordingRequestUseCase(capture),
    },
    logger,
    dispose: async () => {
      await engine.dispose();
      catalog.dispose();
    },
  };
}
