import { DomainError } from '@screen-recorder/domain';

import {
  CaptureServiceClient,
  type NativeRequestOptions,
  type NativeServiceClientError,
  type NativeServiceClientOptions,
  type NativeServiceFailure,
} from './capture-service-client';
import type { NativeCommand } from './native-service-protocol';

const retryableIdleCommands = new Set<NativeCommand>([
  'getCapabilities',
  'listSources',
  'getPermissions',
  'getHealth',
  'heartbeat',
]);

function isNativeRequestTimeout(error: unknown): error is NativeServiceClientError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'NATIVE_REQUEST_TIMEOUT'
  );
}

export interface NativeServiceSupervisorOptions extends NativeServiceClientOptions {
  readonly onFailure?: (failure: NativeServiceFailure & { readonly sessionId?: string }) => void;
}

/**
 * Serializes recording ownership around the helper process. A helper restart is safe while idle;
 * during a recording the supervisor preserves the active session and surfaces the crash instead of
 * silently starting a second capture.
 */
export class NativeServiceSupervisor {
  private readonly client: CaptureServiceClient;
  private readonly failureListeners = new Set<
    (failure: NativeServiceFailure & { readonly sessionId?: string }) => void
  >();
  private activeSessionId: string | undefined;
  private startingSessionId: string | undefined;
  private disposed = false;

  public constructor(options: NativeServiceSupervisorOptions) {
    const { onFailure, ...clientOptions } = options;
    this.client = new CaptureServiceClient({
      ...clientOptions,
      onFailure: (failure) => {
        const sessionId = this.recordingSessionId;

        // Read-only idle requests are retried once below. Do not flash a native-service failure in
        // the UI unless the retry also fails and is returned through the original IPC operation.
        if (failure.error.code === 'NATIVE_REQUEST_TIMEOUT' && sessionId === undefined) {
          return;
        }

        const enrichedFailure = { ...failure, sessionId };
        onFailure?.(enrichedFailure);
        for (const listener of this.failureListeners) {
          listener(enrichedFailure);
        }
      },
    });
  }

  public get recordingSessionId(): string | undefined {
    return this.activeSessionId ?? this.startingSessionId;
  }

  public onFailure(
    listener: (failure: NativeServiceFailure & { readonly sessionId?: string }) => void,
  ): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  public async request<TResponse = unknown>(
    command: NativeCommand,
    payload: unknown = null,
    options?: NativeRequestOptions,
  ): Promise<TResponse> {
    if (this.disposed) {
      throw new DomainError(
        'NATIVE_SERVICE_FAILURE',
        'The native capture service has been disposed.',
      );
    }

    if (this.recordingSessionId !== undefined && !this.client.running) {
      throw new DomainError(
        'HELPER_FAILURE',
        'CaptureService stopped during a recording and will not be restarted automatically.',
      );
    }

    try {
      return await this.client.request<TResponse>(command, payload, options);
    } catch (error) {
      const canRetry =
        this.recordingSessionId === undefined &&
        retryableIdleCommands.has(command) &&
        isNativeRequestTimeout(error) &&
        !options?.signal?.aborted;

      if (!canRetry) {
        throw error;
      }

      // The client disposes the timed-out process before rejecting, so this request starts a clean
      // helper. Mutating recording commands are intentionally never replayed.
      return this.client.request<TResponse>(command, payload, options);
    }
  }

  public reserveRecording(sessionId: string): void {
    if (this.activeSessionId !== undefined || this.startingSessionId !== undefined) {
      throw new DomainError(
        'RECORDING_ALREADY_ACTIVE',
        'Only one native recording session can be active at a time.',
      );
    }

    this.startingSessionId = sessionId;
  }

  public commitRecording(sessionId: string): void {
    if (this.startingSessionId !== sessionId) {
      throw new DomainError(
        'NATIVE_SERVICE_FAILURE',
        'The native recording reservation is invalid.',
      );
    }

    this.startingSessionId = undefined;
    this.activeSessionId = sessionId;
  }

  public releaseRecording(sessionId: string): void {
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = undefined;
    }

    if (this.startingSessionId === sessionId) {
      this.startingSessionId = undefined;
    }
  }

  public assertActive(sessionId: string): void {
    if (this.activeSessionId !== sessionId) {
      throw new DomainError(
        'RECORDING_NOT_FOUND',
        `Native recording session ${sessionId} was not found.`,
      );
    }
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    this.activeSessionId = undefined;
    this.startingSessionId = undefined;
    await this.client.dispose();
  }
}

export type NativeServiceFailureListener = (
  failure: NativeServiceFailure & { readonly sessionId?: string },
) => void;

export type { NativeServiceClientError };
