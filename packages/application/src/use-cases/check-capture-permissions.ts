import type { CapturePermissions } from '@screen-recorder/domain';

import type { CapturePort } from '../ports/capture-port';

export class CheckCapturePermissionsUseCase {
  public constructor(private readonly capture: CapturePort) {}

  public execute(): Promise<CapturePermissions> {
    return this.capture.getPermissions();
  }
}
