import { shell } from 'electron';
import type { PermissionSettingsTarget, SystemSettingsPort } from '@screen-recorder/application';

const permissionUrls: Readonly<Record<PermissionSettingsTarget, string>> = {
  'screen-recording':
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};

export class MacOsSystemSettings implements SystemSettingsPort {
  public async openPermissionSettings(target: PermissionSettingsTarget): Promise<void> {
    await shell.openExternal(permissionUrls[target]);
  }
}
