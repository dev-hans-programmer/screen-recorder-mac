import { randomUUID } from 'node:crypto';

import { ipcChannels, type IpcEvent } from '@screen-recorder/contracts';
import type {
  ApplicationEvent,
  ApplicationEventPublisher,
  Logger,
} from '@screen-recorder/application';

import { toIpcEvent } from './mappers';

export class IpcEventPublisher implements ApplicationEventPublisher {
  public constructor(
    private readonly send: (event: IpcEvent) => void,
    private readonly logger?: Logger,
  ) {}

  public publish(event: ApplicationEvent): void {
    this.log(event);
    this.send(toIpcEvent(event, randomUUID()));
  }

  private log(event: ApplicationEvent): void {
    if (event.type === 'recording.progress') return;
    if (event.type === 'recording.state-changed') {
      this.logger?.info('Recording state changed.', {
        sessionId: event.sessionId,
        state: event.state,
      });
    } else if (event.type === 'recording.completed') {
      this.logger?.info('Recording completed.', {
        sessionId: event.sessionId,
        width: event.artifact.width,
        height: event.artifact.height,
        durationMs: event.artifact.durationMs,
        codec: event.artifact.codec,
        fileSizeBytes: event.artifact.fileSizeBytes,
      });
    } else if (event.type === 'recording.failed' || event.type === 'native-service.failed') {
      this.logger?.error('Recording service failure.', {
        type: event.type,
        sessionId: event.sessionId,
        ...(event.type === 'recording.failed'
          ? { reason: event.reason }
          : { operation: event.operation, message: event.message }),
      });
    } else if (
      event.type === 'recording.warning' ||
      event.type === 'recording.dropped-frames' ||
      event.type === 'recording.disk-space-warning'
    ) {
      this.logger?.warn('Recording warning emitted.', {
        type: event.type,
        sessionId: event.sessionId,
        ...(event.type === 'recording.warning'
          ? { code: event.code, message: event.message }
          : event.type === 'recording.dropped-frames'
            ? { droppedFrames: event.droppedFrames, totalFrames: event.totalFrames }
            : {
                availableBytes: event.availableBytes,
                estimatedRequiredBytes: event.estimatedRequiredBytes,
              }),
      });
    } else if (event.type === 'permissions.changed') {
      this.logger?.info('Capture permission state changed.', {
        screenRecording: event.screenRecording,
        microphone: event.microphone,
        requiresRestart: event.screenRecordingRequiresRestart,
      });
    }
  }
}

export function createWindowEventPublisher(
  sendToRenderer: (channel: string, event: IpcEvent) => void,
  logger?: Logger,
): IpcEventPublisher {
  return new IpcEventPublisher((event) => sendToRenderer(ipcChannels.event, event), logger);
}
