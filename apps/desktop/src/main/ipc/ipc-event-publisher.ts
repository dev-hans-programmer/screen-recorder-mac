import { randomUUID } from 'node:crypto';

import { ipcChannels, type IpcEvent } from '@screen-recorder/contracts';
import type { ApplicationEvent, ApplicationEventPublisher } from '@screen-recorder/application';

import { toIpcEvent } from './mappers';

export class IpcEventPublisher implements ApplicationEventPublisher {
  public constructor(private readonly send: (event: IpcEvent) => void) {}

  public publish(event: ApplicationEvent): void {
    this.send(toIpcEvent(event, randomUUID()));
  }
}

export function createWindowEventPublisher(
  sendToRenderer: (channel: string, event: IpcEvent) => void,
): IpcEventPublisher {
  return new IpcEventPublisher((event) => sendToRenderer(ipcChannels.event, event));
}
