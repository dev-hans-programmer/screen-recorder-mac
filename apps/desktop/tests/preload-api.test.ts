import { describe, expect, it } from 'vitest';

import { ipcChannels, protocolVersion } from '@screen-recorder/contracts';

import { createScreenRecorderApi } from '../src/preload/api';

describe('secure preload API', () => {
  it('exposes purpose-built commands on the single command channel', async () => {
    const calls: unknown[] = [];
    const api = createScreenRecorderApi(
      {
        invoke: async (channel, request) => {
          calls.push({ channel, request });
          const typedRequest = request as { readonly requestId: string; readonly command: string };

          return {
            protocolVersion,
            requestId: typedRequest.requestId,
            command: typedRequest.command,
            ok: true,
            data: [],
          };
        },
        on: () => undefined,
        removeListener: () => undefined,
      },
      () => 'request-1',
    );

    await expect(api.listCaptureSources()).resolves.toEqual([]);
    expect(calls).toEqual([
      {
        channel: ipcChannels.command,
        request: {
          protocolVersion,
          requestId: 'request-1',
          command: 'capture.list-sources',
          payload: {},
        },
      },
    ]);
  });

  it('returns an unsubscribe function that removes the exact listener', () => {
    let registeredListener: ((event: unknown, payload: unknown) => void) | undefined;
    let removedListener: ((event: unknown, payload: unknown) => void) | undefined;
    const api = createScreenRecorderApi({
      invoke: () => Promise.resolve(),
      on: (_channel, listener) => {
        registeredListener = listener;
      },
      removeListener: (_channel, listener) => {
        removedListener = listener;
      },
    });
    const events: string[] = [];

    const unsubscribe = api.onEvent((event) => events.push(event.type));
    registeredListener?.(undefined, {
      protocolVersion,
      eventId: 'event-1',
      version: 1,
      type: 'recording.progress',
      sessionId: 'session-1',
      durationMs: 1_000,
      encodedBytes: 20_000,
      occurredAt: 1_000,
    });
    unsubscribe();

    expect(events).toEqual(['recording.progress']);
    expect(removedListener).toBe(registeredListener);
  });

  it('drops malformed events and cleanup prevents subsequent delivery', () => {
    let listener: ((event: unknown, payload: unknown) => void) | undefined;
    const api = createScreenRecorderApi({
      invoke: () => Promise.resolve(),
      on: (_channel, registered) => {
        listener = registered;
      },
      removeListener: () => undefined,
    });
    const received: string[] = [];
    const unsubscribe = api.onEvent((event) => received.push(event.type));

    listener?.(undefined, { protocolVersion: 999, type: 'recording.progress' });
    unsubscribe();
    listener?.(undefined, {
      protocolVersion,
      eventId: 'after-cleanup',
      version: 1,
      type: 'recording.progress',
      sessionId: 'session-1',
      durationMs: 1,
      encodedBytes: 1,
      occurredAt: 1,
    });

    expect(received).toEqual([]);
  });

  it('exposes diagnostics export without granting renderer filesystem access', async () => {
    const calls: unknown[] = [];
    const api = createScreenRecorderApi(
      {
        invoke: async (channel, request) => {
          calls.push({ channel, request });
          const typedRequest = request as { readonly requestId: string; readonly command: string };
          return {
            protocolVersion,
            requestId: typedRequest.requestId,
            command: typedRequest.command,
            ok: true,
            data: '/tmp/support.json',
          };
        },
        on: () => undefined,
        removeListener: () => undefined,
      },
      () => 'diagnostics-request',
    );

    await expect(api.exportDiagnostics()).resolves.toBe('/tmp/support.json');
    expect(calls).toEqual([
      {
        channel: ipcChannels.command,
        request: {
          protocolVersion,
          requestId: 'diagnostics-request',
          command: 'diagnostics.export',
          payload: {},
        },
      },
    ]);
  });

  it('keeps region selection and shortcut channels purpose-built', async () => {
    const calls: unknown[] = [];
    const sent: unknown[] = [];
    const api = createScreenRecorderApi(
      {
        invoke: async (channel, request) => {
          calls.push({ channel, request });
          const typedRequest = request as { readonly requestId: string; readonly command: string };
          return {
            protocolVersion,
            requestId: typedRequest.requestId,
            command: typedRequest.command,
            ok: true,
            data: null,
          };
        },
        send: (channel, payload) => sent.push({ channel, payload }),
        on: () => undefined,
        removeListener: () => undefined,
      },
      () => 'region-request',
    );

    await expect(api.selectRegion('display:1')).resolves.toBeNull();
    api.submitRegionSelection({ x: 10, y: 20, width: 400, height: 300 });
    api.cancelRegionSelection();

    expect(calls[0]).toEqual({
      channel: ipcChannels.command,
      request: {
        protocolVersion,
        requestId: 'region-request',
        command: 'capture.select-region',
        payload: { displayId: 'display:1' },
      },
    });
    expect(sent).toEqual([
      {
        channel: ipcChannels.regionSelection,
        payload: { type: 'selected', region: { x: 10, y: 20, width: 400, height: 300 } },
      },
      { channel: ipcChannels.regionSelection, payload: { type: 'cancelled' } },
    ]);
  });
});
