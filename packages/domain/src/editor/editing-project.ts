import type { RecordingMetadata } from '../library/recording-metadata';

export type EditingTrackKind =
  'screen' | 'webcam' | 'microphone' | 'system-audio' | 'music' | 'captions' | 'overlays';

export interface EditingClip {
  readonly id: string;
  readonly sourceRecordingId: string;
  readonly sourceTrackIndex: number | null;
  readonly sourceStartMs: number;
  readonly durationMs: number;
  readonly timelineStartMs: number;
}

export interface EditingTrack {
  readonly id: string;
  readonly kind: EditingTrackKind;
  readonly name: string;
  readonly order: number;
  readonly visible: boolean;
  readonly muted: boolean;
  readonly locked: boolean;
  readonly gain: number;
  readonly clips: readonly EditingClip[];
}

export interface EditingProject {
  readonly schemaVersion: 1;
  readonly recordingId: string;
  readonly title: string;
  readonly durationMs: number;
  readonly updatedAt: number;
  readonly tracks: readonly EditingTrack[];
}

/** Creates a starter project that preserves each stream in the original capture container. */
export function createInitialEditingProject(
  recording: RecordingMetadata,
  updatedAt: number,
): EditingProject {
  const tracks: EditingTrack[] = [];
  const durationMs = recording.durationMs;
  const createClip = (id: string, sourceTrackIndex: number | null): EditingClip => ({
    id: `${recording.id}:${id}:clip`,
    sourceRecordingId: recording.id,
    sourceTrackIndex,
    sourceStartMs: 0,
    durationMs,
    timelineStartMs: 0,
  });
  const addTrack = (kind: EditingTrackKind, name: string, clip?: EditingClip): void => {
    tracks.push({
      id: `${recording.id}:${kind}`,
      kind,
      name,
      order: tracks.length,
      visible: true,
      muted: false,
      locked: false,
      gain: 1,
      clips: clip === undefined ? [] : [clip],
    });
  };

  addTrack('screen', 'Screen', createClip('screen', null));
  addTrack(
    'microphone',
    'Microphone',
    recording.hasMicrophone
      ? createClip('microphone', recording.hasSystemAudio ? 1 : 0)
      : undefined,
  );
  addTrack(
    'system-audio',
    'System audio',
    recording.hasSystemAudio ? createClip('system-audio', 0) : undefined,
  );
  addTrack('webcam', 'Webcam');
  addTrack('music', 'Music');
  addTrack('captions', 'Captions');
  addTrack('overlays', 'Overlays');

  return {
    schemaVersion: 1,
    recordingId: recording.id,
    title: `${recording.title || 'Untitled recording'} – Edited`,
    durationMs,
    updatedAt,
    tracks,
  };
}
