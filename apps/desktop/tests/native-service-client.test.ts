import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  CaptureServiceClient,
  type NativeServiceClientOptions,
} from '../src/main/infrastructure/native/capture-service-client';
import {
  NativeProtocolError,
  parseNativeLine,
} from '../src/main/infrastructure/native/native-service-protocol';

interface FakeRequest {
  readonly requestId: string;
  readonly command: string;
  readonly payload: unknown;
}

class FakeHelperProcess extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public killed = false;
  public respondTo: (request: FakeRequest, helper: FakeHelperProcess) => void = (
    request,
    helper,
  ) => {
    helper.stdout.write(
      `${JSON.stringify({
        protocolVersion: 1,
        serviceVersion: '0.1.0',
        requestId: request.requestId,
        command: request.command,
        ok: true,
        data:
          request.command === 'hello'
            ? { protocolVersion: 1, serviceVersion: '0.1.0', capabilities: [] }
            : { ready: true },
      })}\n`,
    );
  };

  public constructor() {
    super();
    let buffered = '';
    this.stdin.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines.filter(Boolean)) {
        this.respondTo(JSON.parse(line) as FakeRequest, this);
      }
    });
  }

  public kill(): boolean {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  }
}

function createClient(
  helper: FakeHelperProcess,
  overrides: Partial<NativeServiceClientOptions> = {},
): CaptureServiceClient {
  const spawnProcess = vi.fn(() => helper) as unknown as NativeServiceClientOptions['spawnProcess'];

  return new CaptureServiceClient({
    executablePath: '/fake/CaptureService',
    clientVersion: 'test',
    defaultTimeoutMs: 100,
    spawnProcess,
    ...overrides,
  });
}

describe('CaptureServiceClient', () => {
  it('correlates responses and parses unsolicited native events', async () => {
    const helper = new FakeHelperProcess();
    const events: unknown[] = [];
    const client = createClient(helper, { onEvent: (event) => events.push(event) });

    await expect(client.request('getHealth')).resolves.toEqual({ ready: true });
    helper.stdout.write(
      `${JSON.stringify({
        protocolVersion: 1,
        serviceVersion: '0.1.0',
        eventId: 'event-1',
        type: 'recording.progress',
        data: { durationMs: 100 },
      })}\n`,
    );

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ eventId: 'event-1', type: 'recording.progress' });
    await client.dispose();
    expect(helper.killed).toBe(true);
  });

  it('rejects a request when it times out and supports cancellation', async () => {
    const helper = new FakeHelperProcess();
    helper.respondTo = (request, process) => {
      if (request.command === 'hello' || request.command === 'shutdown') {
        process.stdout.write(
          `${JSON.stringify({
            protocolVersion: 1,
            serviceVersion: '0.1.0',
            requestId: request.requestId,
            command: request.command,
            ok: true,
            data: {},
          })}\n`,
        );
      }
    };
    const client = createClient(helper);

    await expect(client.request('heartbeat', null, { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'NATIVE_REQUEST_TIMEOUT',
    });

    const controller = new AbortController();
    const cancelled = client.request('heartbeat', null, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'NATIVE_REQUEST_ABORTED' });
    await client.dispose();
  });

  it('rejects malformed native messages before they can resolve requests', async () => {
    const helper = new FakeHelperProcess();
    helper.respondTo = (_request, process) => process.stdout.write('{not-json}\n');
    const failures: unknown[] = [];
    const client = createClient(helper, {
      onFailure: (failure) => failures.push(failure),
    });

    await expect(client.request('getHealth')).rejects.toMatchObject({
      code: 'NATIVE_PROTOCOL_ERROR',
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ error: { code: 'NATIVE_PROTOCOL_ERROR' } });
  });

  it('surfaces an unexpected helper exit to the caller and supervisor callback', async () => {
    const helper = new FakeHelperProcess();
    helper.respondTo = (request, process) => {
      if (request.command === 'hello') {
        process.stdout.write(
          `${JSON.stringify({
            protocolVersion: 1,
            serviceVersion: '0.1.0',
            requestId: request.requestId,
            command: request.command,
            ok: true,
            data: {},
          })}\n`,
        );
      }
    };
    const failures: unknown[] = [];
    const client = createClient(helper, { onFailure: (failure) => failures.push(failure) });
    const request = client.request('getHealth');
    await new Promise((resolve) => setTimeout(resolve, 0));
    helper.emit('exit', 1, null);

    await expect(request).rejects.toMatchObject({ code: 'HELPER_FAILURE' });
    expect(failures).toHaveLength(1);
  });

  it('exposes protocol parser errors as the dedicated error type', async () => {
    expect(() => parseNativeLine('{"protocolVersion":99}')).toThrowError(NativeProtocolError);
  });
});
