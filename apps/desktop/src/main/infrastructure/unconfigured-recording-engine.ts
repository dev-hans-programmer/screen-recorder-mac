import { DomainError } from '@screen-recorder/domain';

import type { RecordingEngineHandle, RecordingEnginePort } from '@screen-recorder/application';
import type { ValidatedRecordingRequest } from '@screen-recorder/application';
import type { RecordingArtifact } from '@screen-recorder/domain';

/** The native engine is intentionally unavailable until the Swift service phase. */
export class UnconfiguredRecordingEngine implements RecordingEnginePort {
  public start(
    _request: ValidatedRecordingRequest,
    _sessionId: string,
  ): Promise<RecordingEngineHandle> {
    return Promise.reject(
      new DomainError(
        'NATIVE_SERVICE_FAILURE',
        'The native capture service has not been configured yet.',
      ),
    );
  }

  public pause(_handleId: string): Promise<void> {
    return Promise.reject(this.unavailableError());
  }

  public resume(_handleId: string): Promise<void> {
    return Promise.reject(this.unavailableError());
  }

  public stop(_handleId: string): Promise<RecordingArtifact> {
    return Promise.reject(this.unavailableError());
  }

  public dispose(): Promise<void> {
    return Promise.resolve();
  }

  private unavailableError(): DomainError {
    return new DomainError(
      'NATIVE_SERVICE_FAILURE',
      'The native capture service has not been configured yet.',
    );
  }
}
