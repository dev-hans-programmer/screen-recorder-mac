import type { RecordingArtifact, RecordingDiagnostics } from '@screen-recorder/domain';

import type { ValidatedRecordingRequest } from '../services/validate-recording-request';

export interface RecordingEngineHandle {
  readonly id: string;
}

export interface RecordingEngineStopResult {
  readonly artifact: RecordingArtifact;
  readonly diagnostics: RecordingDiagnostics;
}

export interface RecordingEnginePort {
  start(request: ValidatedRecordingRequest, sessionId: string): Promise<RecordingEngineHandle>;
  pause(handleId: string): Promise<void>;
  resume(handleId: string): Promise<void>;
  stop(handleId: string): Promise<RecordingEngineStopResult>;
  dispose?(): Promise<void>;
}
