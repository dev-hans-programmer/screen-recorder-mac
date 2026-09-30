import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';

import type { ApplicationContainer } from '../application/composition-root';
import { parseRecordingMediaUrl, recordingMediaScheme } from './recording-media-url';

/** Must run before Electron becomes ready so Chromium treats the scheme like secure media. */
export function registerRecordingMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: recordingMediaScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Resolves opaque recording IDs through the catalog. The renderer never receives a filesystem
 * path, while Chromium can still issue range requests needed for responsive video seeking.
 */
export function installRecordingMediaProtocol(container: ApplicationContainer): void {
  protocol.handle(recordingMediaScheme, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const recordingId = parseRecordingMediaUrl(request.url);
    if (recordingId === undefined || recordingId.length === 0) {
      return new Response('Invalid recording URL', { status: 400 });
    }

    try {
      const recording = await container.useCases.getRecordingMedia.execute(recordingId);
      return net.fetch(pathToFileURL(recording.filePath).toString(), {
        method: request.method,
        headers: request.headers,
        bypassCustomProtocolHandlers: true,
      });
    } catch {
      return new Response('Recording not found', { status: 404 });
    }
  });
}
