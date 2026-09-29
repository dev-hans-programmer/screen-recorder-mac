import type { CapturePermissions } from '@screen-recorder/domain';

import type { CapturePermissionRequest, CapturePort } from '../ports/capture-port';

export class RequestCapturePermissionsUseCase {
  public constructor(private readonly capture: CapturePort) {}

  public execute(request: CapturePermissionRequest): Promise<CapturePermissions> {
    return this.capture.requestPermissions(request);
  }
}
