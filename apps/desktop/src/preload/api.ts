import {
  ipcChannels,
  parseIpcEvent,
  parseIpcRequest,
  parseIpcResponse,
  protocolVersion,
  type AppPreferencesDto,
  type CapturePermissionsDto,
  type CaptureSourceDto,
  type IpcCommandName,
  type IpcResponse,
  type RecordingArtifactDto,
} from '@screen-recorder/contracts';

import type { ScreenRecorderApi } from '../shared/screen-recorder-api';

interface PreloadIpcTransport {
  invoke(channel: string, request: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

type ResponseData<C extends IpcCommandName> = IpcResponse<C>['data'];

function defaultRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function createScreenRecorderApi(
  transport: PreloadIpcTransport,
  requestId: () => string = defaultRequestId,
): ScreenRecorderApi {
  async function sendCommand<C extends IpcCommandName>(
    command: C,
    payload: unknown,
  ): Promise<ResponseData<C>> {
    const request = parseIpcRequest({
      protocolVersion,
      requestId: requestId(),
      command,
      payload,
    });
    const response = await transport.invoke(ipcChannels.command, request);
    return parseIpcResponse(command, response).data as ResponseData<C>;
  }

  return {
    listCaptureSources: () =>
      sendCommand('capture.list-sources', {}) as Promise<readonly CaptureSourceDto[]>,
    getCapturePermissions: () =>
      sendCommand('capture.get-permissions', {}) as Promise<CapturePermissionsDto>,
    requestCapturePermissions: (request) =>
      sendCommand('capture.request-permissions', request) as Promise<CapturePermissionsDto>,
    validateRecordingRequest: (request) => sendCommand('recording.validate-request', { request }),
    startRecording: (request) => sendCommand('recording.start', { request }),
    pauseRecording: async (sessionId) => {
      await sendCommand('recording.pause', { sessionId });
    },
    resumeRecording: async (sessionId) => {
      await sendCommand('recording.resume', { sessionId });
    },
    stopRecording: (sessionId) =>
      sendCommand('recording.stop', { sessionId }) as Promise<RecordingArtifactDto>,
    listRecordings: () =>
      sendCommand('library.list', {}) as Promise<readonly RecordingArtifactDto[]>,
    getPreferences: () => sendCommand('preferences.get', {}) as Promise<AppPreferencesDto>,
    updatePreferences: (patch) =>
      sendCommand('preferences.update', { patch }) as Promise<AppPreferencesDto>,
    onEvent: (listener) => {
      const wrappedListener = (_event: unknown, payload: unknown): void => {
        listener(parseIpcEvent(payload));
      };

      transport.on(ipcChannels.event, wrappedListener);

      return () => {
        transport.removeListener(ipcChannels.event, wrappedListener);
      };
    },
  };
}
