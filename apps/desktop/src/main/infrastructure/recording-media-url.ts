export const recordingMediaScheme = 'screen-recorder-media';

export function recordingMediaUrl(recordingId: string): string {
  return `${recordingMediaScheme}://recording/${encodeURIComponent(recordingId)}`;
}

export function parseRecordingMediaUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${recordingMediaScheme}:` ||
      url.hostname !== 'recording' ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return undefined;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length === 1 ? decodeURIComponent(segments[0] ?? '') : undefined;
  } catch {
    return undefined;
  }
}
