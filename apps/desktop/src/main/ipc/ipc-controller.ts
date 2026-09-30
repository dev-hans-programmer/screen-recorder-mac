import { ipcMain, type BrowserWindow } from 'electron';
import {
  ipcChannels,
  parseIpcRequest,
  protocolVersion,
  type AppPreferencesDto,
  type IpcRequest,
} from '@screen-recorder/contracts';

import type { ApplicationContainer } from '../application/composition-root';
import type { RegionSelectionManager } from '../infrastructure/region-selection-manager';
import {
  toCapturePermissionsDto,
  toCaptureSourceDto,
  toIpcError,
  toPreferencesDto,
  toPreferencesPatch,
  toRecordingArtifactDto,
  toRecordingMetadataDto,
  toRecordingRequest,
  toRecordingSessionSnapshotDto,
  toValidatedRecordingRequestDto,
} from './mappers';

function successResponse(
  request: Pick<IpcRequest, 'requestId' | 'command'>,
  data: unknown,
): Record<string, unknown> {
  return {
    protocolVersion,
    requestId: request.requestId,
    command: request.command,
    ok: true,
    data,
  };
}

function failureResponse(
  requestId: string,
  command: string,
  error: unknown,
): Record<string, unknown> {
  return {
    protocolVersion,
    requestId,
    command,
    ok: false,
    error: toIpcError(error),
  };
}

function getRequestId(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'requestId' in value) {
    const requestId = value.requestId;

    if (typeof requestId === 'string' && requestId.length > 0) {
      return requestId;
    }
  }

  return 'unknown-request';
}

function getCommand(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'command' in value) {
    const command = value.command;

    if (typeof command === 'string' && command.length > 0) {
      return command;
    }
  }

  return 'unknown-command';
}

export function registerIpcController(
  getMainWindow: () => BrowserWindow | null,
  container: ApplicationContainer,
  regionSelection?: RegionSelectionManager,
  onPreferencesUpdated?: (preferences: AppPreferencesDto) => void,
  onRelaunchRequested?: () => Promise<void>,
): void {
  ipcMain.handle(ipcChannels.command, async (event, rawRequest: unknown) => {
    const requestId = getRequestId(rawRequest);
    const command = getCommand(rawRequest);

    const mainWindow = getMainWindow();

    const trustedSender =
      (mainWindow !== null && event.sender === mainWindow.webContents) ||
      regionSelection?.isOverlayWindow(event.sender) === true;

    if (!trustedSender) {
      return failureResponse(requestId, command, {
        code: 'UNTRUSTED_IPC_SENDER',
        message: 'The IPC sender is not the active application window.',
      });
    }

    let request: IpcRequest;

    try {
      request = parseIpcRequest(rawRequest);
    } catch (error) {
      return failureResponse(requestId, command, error);
    }

    try {
      return await dispatchRequest(
        request,
        container,
        regionSelection,
        onPreferencesUpdated,
        onRelaunchRequested,
      );
    } catch (error) {
      container.logger.error('IPC command failed.', { command: request.command });
      return failureResponse(request.requestId, request.command, error);
    }
  });
}

async function dispatchRequest(
  request: IpcRequest,
  container: ApplicationContainer,
  regionSelection?: RegionSelectionManager,
  onPreferencesUpdated?: (preferences: AppPreferencesDto) => void,
  onRelaunchRequested?: () => Promise<void>,
): Promise<Record<string, unknown>> {
  switch (request.command) {
    case 'capture.list-sources':
      return successResponse(
        request,
        (await container.useCases.listCaptureSources.execute()).map(toCaptureSourceDto),
      );
    case 'capture.get-permissions':
      return successResponse(
        request,
        toCapturePermissionsDto(await container.useCases.checkCapturePermissions.execute()),
      );
    case 'capture.request-permissions':
      return successResponse(
        request,
        toCapturePermissionsDto(
          await container.useCases.requestCapturePermissions.execute(request.payload),
        ),
      );
    case 'capture.select-region':
      if (regionSelection === undefined) {
        throw new Error('Region selection is unavailable.');
      }
      return successResponse(request, await regionSelection.open(request.payload.displayId));
    case 'recording.validate-request': {
      const validation = await container.useCases.validateRecordingRequest.execute(
        toRecordingRequest(request.payload.request),
      );
      return successResponse(request, toValidatedRecordingRequestDto(validation));
    }
    case 'recording.start': {
      const result = await container.useCases.startRecording.execute(
        toRecordingRequest(request.payload.request),
      );
      return successResponse(request, {
        session: toRecordingSessionSnapshotDto(result.session),
        validation: toValidatedRecordingRequestDto(result.validation),
      });
    }
    case 'recording.pause':
      await container.useCases.pauseRecording.execute(request.payload.sessionId);
      return successResponse(request, null);
    case 'recording.resume':
      await container.useCases.resumeRecording.execute(request.payload.sessionId);
      return successResponse(request, null);
    case 'recording.stop':
      return successResponse(
        request,
        toRecordingArtifactDto(
          await container.useCases.stopRecording.execute(request.payload.sessionId),
        ),
      );
    case 'library.list':
      return successResponse(
        request,
        (await container.useCases.listRecordings.execute()).map(toRecordingMetadataDto),
      );
    case 'library.thumbnail':
      return successResponse(
        request,
        (await container.useCases.getRecordingThumbnail.execute(request.payload.recordingId)) ??
          null,
      );
    case 'library.rename':
      return successResponse(
        request,
        toRecordingMetadataDto(
          await container.useCases.renameRecording.execute(
            request.payload.recordingId,
            request.payload.title,
          ),
        ),
      );
    case 'library.open':
      await container.useCases.openRecording.execute(request.payload.recordingId);
      return successResponse(request, null);
    case 'library.reveal':
      await container.useCases.revealRecording.execute(request.payload.recordingId);
      return successResponse(request, null);
    case 'library.delete':
      await container.useCases.deleteRecording.execute(request.payload.recordingId);
      return successResponse(request, null);
    case 'library.open-folder':
      await container.useCases.openRecordingsFolder.execute();
      return successResponse(request, null);
    case 'system.open-permission-settings':
      await container.useCases.openPermissionSettings.execute(request.payload.target);
      return successResponse(request, null);
    case 'app.relaunch':
      if (onRelaunchRequested === undefined)
        throw new Error('Application relaunch is unavailable.');
      setTimeout(() => {
        void onRelaunchRequested().catch(() => {
          container.logger.error('Application relaunch failed.');
        });
      }, 100);
      return successResponse(request, null);
    case 'diagnostics.export': {
      const filePath = await container.useCases.exportDiagnostics.execute();
      container.logger.info(
        filePath === undefined ? 'Diagnostics export was cancelled.' : 'Diagnostics were exported.',
      );
      return successResponse(request, filePath ?? null);
    }
    case 'preferences.get':
      return successResponse(
        request,
        toPreferencesDto(await container.useCases.getPreferences.execute()),
      );
    case 'preferences.choose-output-directory': {
      const preferences = await container.useCases.chooseRecordingDirectory.execute();
      if (preferences === undefined) return successResponse(request, null);
      const preferencesDto = toPreferencesDto(preferences);
      onPreferencesUpdated?.(preferencesDto);
      return successResponse(request, preferencesDto);
    }
    case 'preferences.update': {
      const preferences = toPreferencesDto(
        await container.useCases.updatePreferences.execute(
          toPreferencesPatch(request.payload.patch),
        ),
      );
      onPreferencesUpdated?.(preferences);
      return successResponse(request, preferences);
    }
  }

  throw new Error('Unsupported IPC command.');
}
