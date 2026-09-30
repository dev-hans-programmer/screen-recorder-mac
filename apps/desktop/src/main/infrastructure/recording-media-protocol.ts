import { net, protocol } from 'electron';
import path from 'node:path';
import { stat } from 'node:fs/promises';
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
      const mediaPath = await container.useCases.getRecordingPreview.execute(recordingId);
      const metadata = await stat(mediaPath);
      const requestedRange = resolveByteRange(request.headers.get('range'), metadata.size);
      if (requestedRange === null) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${metadata.size}` },
        });
      }

      const range = requestedRange ?? { start: 0, end: Math.max(0, metadata.size - 1) };
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=0',
        'Content-Length': String(Math.max(0, range.end - range.start + 1)),
        'Content-Type': mediaContentType(mediaPath),
        'Last-Modified': metadata.mtime.toUTCString(),
      });
      if (requestedRange !== undefined) {
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${metadata.size}`);
      }
      if (request.method === 'HEAD') {
        return new Response(null, { status: requestedRange === undefined ? 200 : 206, headers });
      }

      const source = await net.fetch(pathToFileURL(mediaPath).toString(), {
        headers:
          requestedRange === undefined ? undefined : { range: `bytes=${range.start}-${range.end}` },
        bypassCustomProtocolHandlers: true,
      });
      if (!source.ok || source.body === null) return source;
      return new Response(source.body, {
        status: requestedRange === undefined ? 200 : 206,
        headers,
      });
    } catch {
      return new Response('Recording not found', { status: 404 });
    }
  });
}

export interface ResolvedByteRange {
  readonly start: number;
  readonly end: number;
}

/** Resolves one RFC 9110 byte range. Chromium requests single ranges for local media playback. */
export function resolveByteRange(
  value: string | null,
  fileSize: number,
): ResolvedByteRange | null | undefined {
  if (value === null) return undefined;
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (match === null) return null;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (startText.length === 0 && endText.length === 0) return null;

  if (startText.length === 0) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText.length === 0 ? fileSize - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= fileSize ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, fileSize - 1) };
}

function mediaContentType(filePath: string): string {
  return path.extname(filePath).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4';
}
