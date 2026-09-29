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
});
