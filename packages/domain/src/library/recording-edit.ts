import { DomainError } from '../errors/domain-error';
import { normalizeRecordingTitle } from './recording-metadata';
import type { EditingProject } from '../editor/editing-project';

export type RecordingRotation = 0 | 90 | 180 | 270;

export interface NormalizedCropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RecordingMuteRange {
  readonly startMs: number;
  readonly endMs: number;
}

export interface RecordingEditPlan {
  readonly recordingId: string;
  readonly title: string;
  readonly trimStartMs: number;
  readonly trimEndMs: number;
  readonly crop: NormalizedCropRect;
  readonly rotation: RecordingRotation;
  readonly mutedRanges: readonly RecordingMuteRange[];
  readonly posterTimeMs: number;
  readonly project?: EditingProject;
}

export type RecordingEditPlanInput = RecordingEditPlan;

const minimumEditedDurationMs = 100;
const minimumCropFraction = 0.02;

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new DomainError('INVALID_VALUE', `${label} must be a finite number.`);
  }
}

function normalizeMuteRanges(
  ranges: readonly RecordingMuteRange[],
  trimStartMs: number,
  trimEndMs: number,
): readonly RecordingMuteRange[] {
  const sorted = ranges
    .map((range) => {
      finite(range.startMs, 'Mute range start');
      finite(range.endMs, 'Mute range end');
      if (range.startMs < trimStartMs || range.endMs > trimEndMs || range.endMs <= range.startMs) {
        throw new DomainError(
          'INVALID_VALUE',
          'Mute ranges must be inside the editable timeline and have a positive duration.',
        );
      }
      return { startMs: range.startMs, endMs: range.endMs };
    })
    .sort((left, right) => left.startMs - right.startMs);

  const merged: RecordingMuteRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.startMs <= previous.endMs) {
      merged[merged.length - 1] = {
        startMs: previous.startMs,
        endMs: Math.max(previous.endMs, range.endMs),
      };
    } else {
      merged.push(range);
    }
  }
  return Object.freeze(merged.map((range) => Object.freeze(range)));
}

export function createRecordingEditPlan(
  input: RecordingEditPlanInput,
  sourceDurationMs: number,
): RecordingEditPlan {
  finite(sourceDurationMs, 'Source duration');
  finite(input.trimStartMs, 'Trim start');
  finite(input.trimEndMs, 'Trim end');
  finite(input.posterTimeMs, 'Poster frame time');

  if (input.recordingId.trim().length === 0) {
    throw new DomainError('INVALID_VALUE', 'A source recording is required.');
  }
  if (input.project !== undefined && input.project.recordingId !== input.recordingId) {
    throw new DomainError(
      'INVALID_VALUE',
      'The editing project must use the selected source recording.',
    );
  }
  if (input.project !== undefined) {
    const project = input.project;
    const trackIds = new Set(project.tracks.map((track) => track.id));
    const invalidClip = project.tracks.some((track) =>
      track.clips.some(
        (clip) =>
          clip.sourceRecordingId !== input.recordingId ||
          clip.sourceStartMs + clip.durationMs > sourceDurationMs + 1 ||
          clip.timelineStartMs + clip.durationMs > project.durationMs + 1,
      ),
    );
    if (
      !Number.isFinite(project.durationMs) ||
      project.durationMs !== sourceDurationMs ||
      trackIds.size !== project.tracks.length ||
      invalidClip
    ) {
      throw new DomainError('INVALID_VALUE', 'The editing project timeline is invalid.');
    }
  }
  if (
    input.trimStartMs < 0 ||
    input.trimEndMs > sourceDurationMs ||
    input.trimEndMs - input.trimStartMs < minimumEditedDurationMs
  ) {
    throw new DomainError(
      'INVALID_VALUE',
      'The trim range must be at least 0.1 seconds and remain inside the source recording.',
    );
  }
  if (input.posterTimeMs < input.trimStartMs || input.posterTimeMs > input.trimEndMs) {
    throw new DomainError('INVALID_VALUE', 'The poster frame must be inside the selected trim.');
  }
  if (![0, 90, 180, 270].includes(input.rotation)) {
    throw new DomainError('INVALID_VALUE', 'The recording rotation is unsupported.');
  }

  const cropValues = [input.crop.x, input.crop.y, input.crop.width, input.crop.height];
  cropValues.forEach((value) => finite(value, 'Crop value'));
  if (
    input.crop.x < 0 ||
    input.crop.y < 0 ||
    input.crop.width < minimumCropFraction ||
    input.crop.height < minimumCropFraction ||
    input.crop.x + input.crop.width > 1.000_001 ||
    input.crop.y + input.crop.height > 1.000_001
  ) {
    throw new DomainError('INVALID_VALUE', 'The crop rectangle must remain inside the video.');
  }

  return Object.freeze({
    recordingId: input.recordingId,
    title: normalizeRecordingTitle(input.title),
    trimStartMs: input.trimStartMs,
    trimEndMs: input.trimEndMs,
    crop: Object.freeze({ ...input.crop }),
    rotation: input.rotation,
    mutedRanges: normalizeMuteRanges(
      input.mutedRanges,
      input.project === undefined ? input.trimStartMs : 0,
      input.project?.durationMs ?? input.trimEndMs,
    ),
    posterTimeMs: input.posterTimeMs,
    ...(input.project === undefined ? {} : { project: input.project }),
  });
}
