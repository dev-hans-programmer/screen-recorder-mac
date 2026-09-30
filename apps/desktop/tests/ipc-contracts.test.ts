import { describe, expect, it } from 'vitest';

import {
  IpcProtocolError,
  parseIpcEvent,
  parseIpcRequest,
  parseIpcResponse,
  protocolVersion,
} from '@screen-recorder/contracts';

describe('IPC contracts', () => {
  it('accepts a versioned command with a known payload', () => {
    const request = parseIpcRequest({
      protocolVersion,
      requestId: 'request-1',
      command: 'capture.request-permissions',
      payload: { microphone: true },
    });

    expect(request.command).toBe('capture.request-permissions');
  });

  it('validates region selection requests and responses', () => {
    const request = parseIpcRequest({
      protocolVersion,
      requestId: 'region-request',
      command: 'capture.select-region',
      payload: { displayId: 'display:1' },
    });
    const response = parseIpcResponse('capture.select-region', {
      protocolVersion,
      requestId: 'region-request',
      command: 'capture.select-region',
      ok: true,
      data: { x: 10, y: 20, width: 400, height: 300 },
    });

    expect(request.command).toBe('capture.select-region');
    expect(response.data?.width).toBe(400);
  });

  it('validates the native recording-directory picker contract and cancellation', () => {
    const request = parseIpcRequest({
      protocolVersion,
      requestId: 'directory-request',
      command: 'preferences.choose-output-directory',
      payload: {},
    });
    const response = parseIpcResponse('preferences.choose-output-directory', {
      protocolVersion,
      requestId: 'directory-request',
      command: 'preferences.choose-output-directory',
      ok: true,
      data: null,
    });

    expect(request.command).toBe('preferences.choose-output-directory');
    expect(response.data).toBeNull();
  });

  it('rejects invalid commands before application services can receive them', () => {
    expect(() =>
      parseIpcRequest({
        protocolVersion,
        requestId: 'request-2',
        command: 'recording.start',
        payload: {},
      }),
    ).toThrowError(IpcProtocolError);
  });

  it.each([
    [
      'request',
      () =>
        parseIpcRequest({
          protocolVersion: 999,
          requestId: 'future',
          command: 'capture.list-sources',
          payload: {},
        }),
    ],
    [
      'response',
      () =>
        parseIpcResponse('recording.pause', {
          protocolVersion: 999,
          requestId: 'future',
          command: 'recording.pause',
          ok: true,
          data: null,
        }),
    ],
    [
      'event',
      () =>
        parseIpcEvent({
          protocolVersion: 999,
          eventId: 'future',
          version: 1,
          type: 'recording.progress',
          sessionId: 'session-1',
          durationMs: 1,
          encodedBytes: 1,
          occurredAt: 1,
        }),
    ],
  ])('rejects an unknown protocol version in a %s', (_kind, parse) => {
    expect(parse).toThrowError(IpcProtocolError);
  });

  it('validates response data against the command-specific schema', () => {
    expect(() =>
      parseIpcResponse('recording.pause', {
        protocolVersion,
        requestId: 'request-3',
        command: 'recording.pause',
        ok: true,
        data: { unexpected: true },
      }),
    ).toThrowError(IpcProtocolError);
  });

  it('preserves application error codes so the UI can offer specific recovery', () => {
    let received: unknown;

    try {
      parseIpcResponse('recording.start', {
        protocolVersion,
        requestId: 'request-source-gone',
        command: 'recording.start',
        ok: false,
        error: {
          code: 'INVALID_CAPTURE_SOURCE',
          message: 'The selected source is unavailable.',
          details: { sourceId: 'window:gone' },
        },
      });
    } catch (error) {
      received = error;
    }

    expect(received).toMatchObject({
      code: 'INVALID_CAPTURE_SOURCE',
      details: { sourceId: 'window:gone' },
    });
  });

  it('accepts a serializable versioned event', () => {
    const event = parseIpcEvent({
      protocolVersion,
      eventId: 'event-1',
      version: 1,
      type: 'recording.progress',
      sessionId: 'session-1',
      durationMs: 1_000,
      encodedBytes: 20_000,
      occurredAt: 1_000,
    });

    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  it('validates versioned library metadata and safe rename payloads', () => {
    const request = parseIpcRequest({
      protocolVersion,
      requestId: 'rename-1',
      command: 'library.rename',
      payload: { recordingId: 'recording-1', title: 'Product walkthrough' },
    });
    const response = parseIpcResponse('library.list', {
      protocolVersion,
      requestId: 'list-1',
      command: 'library.list',
      ok: true,
      data: [
        {
          schemaVersion: 1,
          id: 'recording-1',
          filePath: '/tmp/product-walkthrough.mp4',
          title: 'Product walkthrough',
          createdAt: 1_000,
          durationMs: 5_000,
          width: 1920,
          height: 1080,
          frameRate: 60,
          profileId: 'balanced',
          codec: 'hevc',
          hasSystemAudio: true,
          hasMicrophone: false,
          fileSizeBytes: 10_000,
          availability: 'available',
          failure: null,
          recovery: null,
        },
      ],
    });

    expect(request.command).toBe('library.rename');
    expect(response.data[0]?.schemaVersion).toBe(1);
    expect(() =>
      parseIpcRequest({
        protocolVersion,
        requestId: 'rename-2',
        command: 'library.rename',
        payload: { recordingId: 'recording-1', title: '../unsafe' },
      }),
    ).toThrowError(IpcProtocolError);
  });
});
