import type { CapturePermissions } from '@screen-recorder/domain';

import type { CapturePermissionRequest } from './capture-port';

export interface PermissionPort {
  getPermissions(): Promise<CapturePermissions>;
  requestPermissions(request: CapturePermissionRequest): Promise<CapturePermissions>;
}
