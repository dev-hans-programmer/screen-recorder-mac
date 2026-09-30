import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import type { RecordingDirectoryPickerPort } from '@screen-recorder/application';

interface ElectronRecordingDirectoryPickerOptions {
  readonly getParentWindow: () => BrowserWindow | null;
}

export class ElectronRecordingDirectoryPicker implements RecordingDirectoryPickerPort {
  public constructor(private readonly options: ElectronRecordingDirectoryPickerOptions) {}

  public async selectDirectory(defaultPath: string): Promise<string | undefined> {
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose recording location',
      message: 'Choose where completed screen recordings will be saved.',
      buttonLabel: 'Choose Folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    };
    const parentWindow = this.options.getParentWindow();
    const result =
      parentWindow === null || parentWindow.isDestroyed()
        ? await dialog.showOpenDialog(dialogOptions)
        : await dialog.showOpenDialog(parentWindow, dialogOptions);

    if (result.canceled) return undefined;

    const selectedDirectory = result.filePaths[0]?.trim();
    return selectedDirectory === undefined || selectedDirectory.length === 0
      ? undefined
      : selectedDirectory;
  }
}
