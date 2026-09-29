import { DomainError } from '@screen-recorder/domain';

import {
  CaptureServiceClient,
  type NativeRequestOptions,
  type NativeServiceClientError,
  type NativeServiceClientOptions,
  type NativeServiceFailure,
} from './capture-service-client';
import type { NativeCommand } from './native-service-protocol';

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
        const enrichedFailure = { ...failure, sessionId: this.activeSessionId };
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

  public request<TResponse = unknown>(
    command: NativeCommand,
    payload: unknown = null,
    options?: NativeRequestOptions,
  ): Promise<TResponse> {
    if (this.disposed) {
      return Promise.reject(
        new DomainError('NATIVE_SERVICE_FAILURE', 'The native capture service has been disposed.'),
      );
    }

    if (this.recordingSessionId !== undefined && !this.client.running) {
      return Promise.reject(
        new DomainError(
          'HELPER_FAILURE',
          'CaptureService stopped during a recording and will not be restarted automatically.',
        ),
      );
    }

    return this.client.request<TResponse>(command, payload, options);
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
