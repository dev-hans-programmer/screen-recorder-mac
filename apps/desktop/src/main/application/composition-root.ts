import { randomUUID } from 'node:crypto';

import {
  CheckCapturePermissionsUseCase,
  GetPreferencesUseCase,
  ListCaptureSourcesUseCase,
  ListRecordingsUseCase,
  PauseRecordingUseCase,
  RecoverInterruptedRecordingUseCase,
  RequestCapturePermissionsUseCase,
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
    readonly getPreferences: GetPreferencesUseCase;
    readonly listCaptureSources: ListCaptureSourcesUseCase;
    readonly listRecordings: ListRecordingsUseCase;
    readonly pauseRecording: PauseRecordingUseCase;
    readonly recoverInterruptedRecording: RecoverInterruptedRecordingUseCase;
    readonly requestCapturePermissions: RequestCapturePermissionsUseCase;
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
}

export function createApplicationContainer(
  events: ApplicationEventPublisher,
  options: ApplicationContainerOptions,
  logger: Logger = createConsoleLogger(),
): ApplicationContainer {
  const sessions = new InMemoryRecordingRepository();
  const preferences = new InMemoryPreferencesRepository();
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
      getPreferences: new GetPreferencesUseCase(preferences),
      listCaptureSources: new ListCaptureSourcesUseCase(capture),
      listRecordings: new ListRecordingsUseCase(sessions),
      pauseRecording: new PauseRecordingUseCase(sessions, engine, clock, events),
      recoverInterruptedRecording: new RecoverInterruptedRecordingUseCase(sessions, clock, events),
      requestCapturePermissions: new RequestCapturePermissionsUseCase(capture),
      resumeRecording: new ResumeRecordingUseCase(sessions, engine, clock, events),
      startRecording: new StartRecordingUseCase({
        capture,
        engine,
        sessions,
        clock,
        ids,
        events,
      }),
      stopRecording: new StopRecordingUseCase(sessions, engine, clock, events),
      updatePreferences: new UpdatePreferencesUseCase(preferences),
      validateRecordingRequest: new ValidateRecordingRequestUseCase(capture),
    },
    logger,
    dispose: () => engine.dispose(),
  };
}
