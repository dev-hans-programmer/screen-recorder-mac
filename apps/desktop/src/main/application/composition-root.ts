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
  type Clock,
  type IdGenerator,
  type Logger,
} from '@screen-recorder/application';

import { createConsoleLogger } from '../infrastructure/logger';
import {
  InMemoryPreferencesRepository,
  InMemoryRecordingRepository,
} from '../infrastructure/in-memory-repositories';
import { UnconfiguredCapturePort } from '../infrastructure/unconfigured-capture-port';
import { UnconfiguredRecordingEngine } from '../infrastructure/unconfigured-recording-engine';

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
  readonly capture: UnconfiguredCapturePort;
  readonly engine: UnconfiguredRecordingEngine;
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

export function createApplicationContainer(
  events: ApplicationEventPublisher,
  logger: Logger = createConsoleLogger(),
): ApplicationContainer {
  const capture = new UnconfiguredCapturePort();
  const engine = new UnconfiguredRecordingEngine();
  const sessions = new InMemoryRecordingRepository();
  const preferences = new InMemoryPreferencesRepository();
  const clock = new SystemClock();
  const ids = new RandomIdGenerator();

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
