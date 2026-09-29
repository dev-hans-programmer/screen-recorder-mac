import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { randomUUID } from 'node:crypto';

import {
  isNativeEvent,
  nativeProtocolVersion,
  parseNativeLine,
  type NativeCommand,
  type NativeEvent,
  type NativeResponse,
} from './native-service-protocol';

export interface NativeServiceClientErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class NativeServiceClientError extends Error {
  public readonly code: string;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(options: NativeServiceClientErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'NativeServiceClientError';
    this.code = options.code;
    this.details = options.details;
  }
}

export interface NativeServiceFailure {
  readonly error: NativeServiceClientError;
  readonly operation: string;
}

export interface NativeServiceClientOptions {
  readonly executablePath: string;
  readonly clientVersion: string;
  readonly defaultTimeoutMs?: number;
  readonly spawnProcess?: typeof spawn;
  readonly onEvent?: (event: NativeEvent) => void;
  readonly onFailure?: (failure: NativeServiceFailure) => void;
  readonly onLog?: (message: string) => void;
}

export interface NativeRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface PendingRequest {
  readonly requestId: string;
  readonly command: NativeCommand;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

export class CaptureServiceClient {
  private readonly executablePath: string;
  private readonly clientVersion: string;
  private readonly defaultTimeoutMs: number;
  private readonly spawnProcess: typeof spawn;
  private readonly onEvent: ((event: NativeEvent) => void) | undefined;
  private readonly onFailure: ((failure: NativeServiceFailure) => void) | undefined;
  private readonly onLog: ((message: string) => void) | undefined;
  private readonly pending = new Map<string, PendingRequest>();

  private child: ChildProcessWithoutNullStreams | undefined;
  private output: Interface | undefined;
  private startPromise: Promise<void> | undefined;
  private disposePromise: Promise<void> | undefined;
  private isClosing = false;
  private lastOperation = 'startup';

  public constructor(options: NativeServiceClientOptions) {
    this.executablePath = options.executablePath;
    this.clientVersion = options.clientVersion;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.onEvent = options.onEvent;
    this.onFailure = options.onFailure;
    this.onLog = options.onLog;
  }

  public get running(): boolean {
    return this.child !== undefined;
  }

  public async request<TResponse = unknown>(
    command: NativeCommand,
    payload: unknown = null,
    options: NativeRequestOptions = {},
  ): Promise<TResponse> {
    if (options.signal?.aborted) {
      throw new NativeServiceClientError({
        code: 'NATIVE_REQUEST_ABORTED',
        message: `Native request ${command} was cancelled before it started.`,
      });
    }

    await this.ensureStarted();

    if (options.signal?.aborted) {
      throw new NativeServiceClientError({
        code: 'NATIVE_REQUEST_ABORTED',
        message: `Native request ${command} was cancelled before it was sent.`,
      });
    }

    this.lastOperation = command;

    return this.requestStarted<TResponse>(command, payload, options);
  }

  public async dispose(): Promise<void> {
    this.disposePromise ??= this.disposeInternal();
    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    if (this.child === undefined) {
      return;
    }

    this.isClosing = true;
    try {
      await this.requestStarted('shutdown', null, { timeoutMs: 1_500 });
    } catch {
      // The process may already be exiting. The explicit termination below is the fallback.
    }
    this.closeTransport();
  }

  private async ensureStarted(): Promise<void> {
    if (this.child !== undefined) {
      return;
    }

    this.startPromise ??= this.spawnAndHandshake();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async spawnAndHandshake(): Promise<void> {
    this.isClosing = false;
    this.lastOperation = 'startup';

    let child: ChildProcessWithoutNullStreams;

    try {
      child = this.spawnProcess(this.executablePath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      const clientError = new NativeServiceClientError({
        code: 'HELPER_FAILURE',
        message: `Unable to start CaptureService: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      });
      this.notifyFailure(clientError, 'startup');
      throw clientError;
    }

    this.child = child;
    this.output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.output.on('line', (line) => this.handleLine(line));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim();
      if (message.length > 0) {
        this.onLog?.(message);
      }
    });
    child.once('error', (error) => {
      this.handleProcessFailure(
        new NativeServiceClientError({
          code: 'HELPER_FAILURE',
          message: `CaptureService failed: ${error.message}`,
          cause: error,
        }),
      );
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child || this.isClosing) {
        return;
      }

      this.handleProcessFailure(
        new NativeServiceClientError({
          code: 'HELPER_FAILURE',
          message: `CaptureService exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`,
        }),
      );
    });

    try {
      await this.requestStarted<{ protocolVersion: number }>(
        'hello',
        { clientVersion: this.clientVersion },
        {},
      );
    } catch (error) {
      const clientError = this.asClientError(error, 'CaptureService handshake failed.');
      this.handleProcessFailure(clientError, false);
      throw clientError;
    }
  }

  private requestStarted<TResponse>(
    command: NativeCommand,
    payload: unknown,
    options: NativeRequestOptions,
  ): Promise<TResponse> {
    const child = this.child;

    if (child === undefined) {
      return Promise.reject(
        new NativeServiceClientError({
          code: 'HELPER_FAILURE',
          message: 'CaptureService is not running.',
        }),
      );
    }

    const requestId = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<TResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timeoutError = new NativeServiceClientError({
          code: 'NATIVE_REQUEST_TIMEOUT',
          message: `Native request ${command} timed out after ${timeoutMs}ms.`,
        });

        // A timed-out helper may still be blocked inside ScreenCaptureKit. Closing the entire
        // transport prevents every later command from being sent to the same unresponsive process.
        this.handleProcessFailure(timeoutError);
      }, timeoutMs);

      const onAbort = (): void => {
        this.settlePending(requestId, {
          reject: new NativeServiceClientError({
            code: 'NATIVE_REQUEST_ABORTED',
            message: `Native request ${command} was cancelled.`,
          }),
        });
      };

      const pending: PendingRequest = {
        requestId,
        command,
        resolve: (value) => resolve(value as TResponse),
        reject,
        timer,
        signal: options.signal,
        onAbort,
      };
      this.pending.set(requestId, pending);
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const request = JSON.stringify({
        protocolVersion: nativeProtocolVersion,
        requestId,
        command,
        payload,
      });

      try {
        child.stdin.write(`${request}\n`);
      } catch (error) {
        this.settlePending(requestId, {
          reject: new NativeServiceClientError({
            code: 'HELPER_FAILURE',
            message: `Unable to send native request ${command}.`,
            cause: error,
          }),
        });
      }
    });
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) {
      return;
    }

    let message: NativeResponse | NativeEvent;

    try {
      message = parseNativeLine(line);
    } catch (error) {
      this.handleProcessFailure(
        this.asClientError(error, 'CaptureService emitted an invalid protocol message.'),
      );
      return;
    }

    if (isNativeEvent(message)) {
      this.onEvent?.(message);
      return;
    }

    const pending = this.pending.get(message.requestId);

    if (pending === undefined) {
      this.onLog?.(`Ignoring native response for unknown request ${message.requestId}.`);
      return;
    }

    if (message.command !== pending.command) {
      this.settlePending(message.requestId, {
        reject: new NativeServiceClientError({
          code: 'NATIVE_PROTOCOL_ERROR',
          message: `Native response command mismatch: expected ${pending.command}, received ${message.command}.`,
        }),
      });
      return;
    }

    if (message.ok) {
      this.settlePending(message.requestId, { resolve: message.data });
    } else {
      this.settlePending(message.requestId, {
        reject: new NativeServiceClientError({
          code: message.error.code,
          message: message.error.message,
          details: message.error.details,
        }),
      });
    }
  }

  private handleProcessFailure(error: NativeServiceClientError, notify = true): void {
    if (this.child === undefined && this.pending.size === 0) {
      return;
    }

    const operation = this.lastOperation;
    this.closeTransport(error);

    if (notify) {
      this.notifyFailure(error, operation);
    }
  }

  private closeTransport(error?: NativeServiceClientError): void {
    const child = this.child;
    this.child = undefined;
    this.output?.close();
    this.output = undefined;

    for (const requestId of [...this.pending.keys()]) {
      this.settlePending(requestId, {
        reject:
          error ??
          new NativeServiceClientError({
            code: 'HELPER_FAILURE',
            message: 'CaptureService connection closed.',
          }),
      });
    }

    if (child !== undefined) {
      child.stdin.end();
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }
  }

  private settlePending(
    requestId: string,
    result: { readonly resolve?: unknown; readonly reject?: unknown },
  ): void {
    const pending = this.pending.get(requestId);

    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.onAbort ?? (() => undefined));
    this.pending.delete(requestId);

    if ('reject' in result && result.reject !== undefined) {
      pending.reject(result.reject);
      return;
    }

    pending.resolve(result.resolve);
  }

  private notifyFailure(error: NativeServiceClientError, operation: string): void {
    this.onFailure?.({ error, operation });
  }

  private asClientError(error: unknown, fallbackMessage: string): NativeServiceClientError {
    if (error instanceof NativeServiceClientError) {
      return error;
    }

    if (error instanceof Error) {
      return new NativeServiceClientError({
        code: 'NATIVE_PROTOCOL_ERROR',
        message: error.message,
        cause: error,
      });
    }

    return new NativeServiceClientError({
      code: 'NATIVE_PROTOCOL_ERROR',
      message: fallbackMessage,
    });
  }
}
