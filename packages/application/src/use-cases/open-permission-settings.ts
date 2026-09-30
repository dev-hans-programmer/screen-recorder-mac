import type { PermissionSettingsTarget, SystemSettingsPort } from '../ports/platform-ports';

export class OpenPermissionSettingsUseCase {
  public constructor(private readonly settings: SystemSettingsPort) {}

  public execute(target: PermissionSettingsTarget): Promise<void> {
    return this.settings.openPermissionSettings(target);
  }
}
