import { ipcMain, type BrowserWindow } from 'electron';
import {
  ipcChannels,
  parseIpcRequest,
  protocolVersion,
  type IpcRequest,
} from '@screen-recorder/contracts';

import type { ApplicationContainer } from '../application/composition-root';
import {
  toCapturePermissionsDto,
  toCaptureSourceDto,
  toIpcError,
  toPreferencesDto,
  toPreferencesPatch,
  toRecordingArtifactDto,
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
): void {
  ipcMain.handle(ipcChannels.command, async (event, rawRequest: unknown) => {
    const requestId = getRequestId(rawRequest);
    const command = getCommand(rawRequest);

    const mainWindow = getMainWindow();

    if (mainWindow === null || event.sender !== mainWindow.webContents) {
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
      return await dispatchRequest(request, container);
    } catch (error) {
      container.logger.error('IPC command failed.', { command: request.command });
      return failureResponse(request.requestId, request.command, error);
    }
  });
}

async function dispatchRequest(
  request: IpcRequest,
  container: ApplicationContainer,
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
        (await container.useCases.listRecordings.execute()).map(toRecordingArtifactDto),
      );
    case 'preferences.get':
      return successResponse(
        request,
        toPreferencesDto(await container.useCases.getPreferences.execute()),
      );
    case 'preferences.update':
      return successResponse(
        request,
        toPreferencesDto(
          await container.useCases.updatePreferences.execute(
            toPreferencesPatch(request.payload.patch),
          ),
        ),
      );
  }

  throw new Error('Unsupported IPC command.');
}
