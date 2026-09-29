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
});
