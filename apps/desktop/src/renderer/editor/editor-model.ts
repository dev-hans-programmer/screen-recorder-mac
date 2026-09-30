import type { RecordingMetadataDto } from '@screen-recorder/contracts';

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function centeredCropForAspect(
  recording: Pick<RecordingMetadataDto, 'width' | 'height'>,
  targetAspect: number,
): CropRect {
  const sourceAspect = recording.width / recording.height;
  if (sourceAspect > targetAspect) {
    const width = targetAspect / sourceAspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = sourceAspect / targetAspect;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function outputDimensions(
  recording: Pick<RecordingMetadataDto, 'width' | 'height'>,
  crop: CropRect,
  rotation: 0 | 90 | 180 | 270,
): { readonly width: number; readonly height: number } {
  const width = Math.max(2, Math.floor((recording.width * crop.width) / 2) * 2);
  const height = Math.max(2, Math.floor((recording.height * crop.height) / 2) * 2);
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

export function formatEditorTime(milliseconds: number): string {
  const totalTenths = Math.max(0, Math.floor(milliseconds / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${totalTenths % 10}`;
}
