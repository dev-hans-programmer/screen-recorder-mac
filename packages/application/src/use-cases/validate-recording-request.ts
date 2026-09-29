import type { RecordingRequest } from '@screen-recorder/domain';

import type { CapturePort } from '../ports/capture-port';
import {
  validateRecordingRequest,
  type ValidatedRecordingRequest,
} from '../services/validate-recording-request';

export class ValidateRecordingRequestUseCase {
  public constructor(private readonly capture: CapturePort) {}

  public async execute(request: RecordingRequest): Promise<ValidatedRecordingRequest> {
    const capabilities = await this.capture.getCapabilities();
    return validateRecordingRequest(request, capabilities);
  }
}
