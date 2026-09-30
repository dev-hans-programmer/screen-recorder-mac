import { describe, expect, it } from 'vitest';

import {
  centeredCropForAspect,
  formatEditorTime,
  outputDimensions,
} from '../src/renderer/editor/editor-model';
import {
  parseRecordingMediaUrl,
  recordingMediaUrl,
} from '../src/main/infrastructure/recording-media-url';

describe('lightweight editor model', () => {
  it('calculates centered crop presets and rotation-aware output dimensions', () => {
    const recording = { width: 1920, height: 1200 };
    const crop = centeredCropForAspect(recording, 16 / 9);

    expect(crop.width).toBe(1);
    expect(crop.height).toBeCloseTo(0.9);
    expect(crop.y).toBeCloseTo(0.05);
    expect(outputDimensions(recording, crop, 90)).toEqual({ width: 1080, height: 1920 });
    expect(formatEditorTime(62_340)).toBe('1:02.3');
  });

  it('round-trips opaque media IDs and rejects broadened URLs', () => {
    const url = recordingMediaUrl('recording:id/1');
    expect(parseRecordingMediaUrl(url)).toBe('recording:id/1');
    expect(parseRecordingMediaUrl(`${url}?path=/tmp/file`)).toBeUndefined();
    expect(parseRecordingMediaUrl('file:///tmp/recording.mp4')).toBeUndefined();
  });
});
