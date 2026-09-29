import type { CaptureSource } from '@screen-recorder/domain';

import type { CapturePort } from '../ports/capture-port';

export class ListCaptureSourcesUseCase {
  public constructor(private readonly capture: CapturePort) {}

  public execute(): Promise<readonly CaptureSource[]> {
    return this.capture.listSources();
  }
}
