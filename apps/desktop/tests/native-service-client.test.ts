import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  CaptureServiceClient,
  type NativeServiceClientOptions,
} from '../src/main/infrastructure/native/capture-service-client';
import { NativeServiceSupervisor } from '../src/main/infrastructure/native/native-service-supervisor';
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

  it('terminates an unresponsive helper when a request times out', async () => {
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
    const failures: unknown[] = [];
    const client = createClient(helper, { onFailure: (failure) => failures.push(failure) });

    await expect(client.request('heartbeat', null, { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'NATIVE_REQUEST_TIMEOUT',
    });
    expect(helper.killed).toBe(true);
    expect(client.running).toBe(false);
    expect(failures).toHaveLength(1);
  });

  it('supports cancellation without terminating a responsive helper', async () => {
    const helper = new FakeHelperProcess();
    helper.respondTo = (request, process) => {
      if (request.command !== 'heartbeat') {
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

    const controller = new AbortController();
    const cancelled = client.request('heartbeat', null, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'NATIVE_REQUEST_ABORTED' });
    expect(client.running).toBe(true);
    await client.dispose();
  });

  it('restarts and retries a read-only idle request once after a timeout', async () => {
    const unresponsiveHelper = new FakeHelperProcess();
    unresponsiveHelper.respondTo = (request, process) => {
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
    const replacementHelper = new FakeHelperProcess();
    const helpers = [unresponsiveHelper, replacementHelper];
    const spawnProcess = vi.fn(() =>
      helpers.shift(),
    ) as unknown as NativeServiceClientOptions['spawnProcess'];
    const failures: unknown[] = [];
    const supervisor = new NativeServiceSupervisor({
      executablePath: '/fake/CaptureService',
      clientVersion: 'test',
      defaultTimeoutMs: 10,
      spawnProcess,
      onFailure: (failure) => failures.push(failure),
    });

    await expect(supervisor.request('getPermissions')).resolves.toEqual({ ready: true });
    expect(unresponsiveHelper.killed).toBe(true);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(0);
    await supervisor.dispose();
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
