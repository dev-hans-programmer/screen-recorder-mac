import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type { RecordingEditRequestDto, RecordingMetadataDto } from '@screen-recorder/contracts';

import { Button, EmptyState, LoadingState, SurfaceCard } from '../app/components';
import { useRendererSelector, type RendererStore } from '../app/renderer-store';
import {
  centeredCropForAspect,
  formatEditorTime,
  outputDimensions,
  type CropRect,
} from './editor-model';

type Rotation = RecordingEditRequestDto['rotation'];
type MuteRange = RecordingEditRequestDto['mutedRanges'][number];

const originalCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export function EditorView({ store }: { readonly store: RendererStore }): ReactElement {
  const recordingId = useRendererSelector(store, (state) => state.editorRecordingId);
  const recording = useRendererSelector(store, (state) =>
    state.recordings.find((candidate) => candidate.id === recordingId),
  );

  if (recording === undefined || recording.availability === 'missing') {
    return (
      <EmptyState
        icon="edit"
        title="Choose a recording to edit"
        description="Open a recording's Actions menu in the library, then choose Edit."
        action={<Button onClick={() => store.closeEditor()}>Back to library</Button>}
      />
    );
  }

  return <RecordingEditor key={recording.id} recording={recording} store={store} />;
}

function RecordingEditor({
  recording,
  store,
}: {
  readonly recording: RecordingMetadataDto;
  readonly store: RendererStore;
}): ReactElement {
  const operation = useRendererSelector(store, (state) => state.operation);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [title, setTitle] = useState(`${recording.title || 'Untitled recording'} – Edited`);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(recording.durationMs);
  const [currentMs, setCurrentMs] = useState(0);
  const [crop, setCrop] = useState<CropRect>(originalCrop);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [mutedRanges, setMutedRanges] = useState<MuteRange[]>([]);
  const [muteStartMs, setMuteStartMs] = useState<number | null>(null);
  const [posterTimeMs, setPosterTimeMs] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const dimensions = useMemo(
    () => outputDimensions(recording, crop, rotation),
    [crop, recording, rotation],
  );
  const exporting = operation === 'exporting-edit';

  useEffect(() => {
    let active = true;
    void store
      .getRecordingMediaUrl(recording.id)
      .then((url) => {
        if (active) setMediaUrl(url);
      })
      .catch((error: unknown) => {
        if (active) {
          setMediaError(
            error instanceof Error ? error.message : 'The video preview is unavailable.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [recording.id, store]);

  function seekTo(milliseconds: number): void {
    const next = Math.min(trimEndMs, Math.max(trimStartMs, milliseconds));
    setCurrentMs(next);
    if (videoRef.current !== null) videoRef.current.currentTime = next / 1_000;
  }

  function updateCrop(patch: Partial<CropRect>): void {
    setCrop((current) => {
      const next = { ...current, ...patch };
      return {
        x: Math.min(0.98, Math.max(0, next.x)),
        y: Math.min(0.98, Math.max(0, next.y)),
        width: Math.min(1 - next.x, Math.max(0.02, next.width)),
        height: Math.min(1 - next.y, Math.max(0.02, next.height)),
      };
    });
  }

  function setCropPreset(aspect: number | null): void {
    setCrop(aspect === null ? originalCrop : centeredCropForAspect(recording, aspect));
  }

  function toggleMuteMarker(): void {
    setLocalError(null);
    if (muteStartMs === null) {
      setMuteStartMs(currentMs);
      return;
    }
    if (currentMs - muteStartMs < 100) {
      setLocalError('Move the playhead at least 0.1 seconds after the mute start.');
      return;
    }
    setMutedRanges((ranges) =>
      [...ranges, { startMs: muteStartMs, endMs: currentMs }].sort(
        (left, right) => left.startMs - right.startMs,
      ),
    );
    setMuteStartMs(null);
  }

  async function exportEdit(): Promise<void> {
    if (title.trim().length === 0) {
      setLocalError('Enter a name for the edited recording.');
      return;
    }
    if (trimEndMs - trimStartMs < 100) {
      setLocalError('Keep at least 0.1 seconds in the edited recording.');
      return;
    }
    setLocalError(null);
    await store.exportEditedRecording({
      recordingId: recording.id,
      title,
      trimStartMs,
      trimEndMs,
      crop,
      rotation,
      mutedRanges,
      posterTimeMs: Math.min(trimEndMs, Math.max(trimStartMs, posterTimeMs)),
    });
  }

  return (
    <div className="editor-workspace">
      <div className="editor-heading">
        <div>
          <div className="section-eyebrow">
            <span className="eyebrow-line" /> Non-destructive editor
          </div>
          <h2>{recording.title || 'Untitled recording'}</h2>
          <p>Your original recording stays untouched. Export creates a new library item.</p>
        </div>
        <div className="editor-heading-actions">
          <Button disabled={exporting} variant="ghost" onClick={() => store.closeEditor()}>
            Cancel
          </Button>
          <Button
            disabled={exporting || mediaUrl === null}
            icon="sparkles"
            variant="primary"
            onClick={() => void exportEdit()}
          >
            {exporting ? 'Exporting…' : 'Export edit'}
          </Button>
        </div>
      </div>

      {(localError !== null || mediaError !== null) && (
        <div className="editor-inline-error" role="alert">
          {localError ?? mediaError}
        </div>
      )}

      <div className="editor-layout">
        <div className="editor-preview-column">
          <SurfaceCard className="editor-preview-card">
            {mediaUrl === null && mediaError === null ? (
              <LoadingState label="Loading preview" />
            ) : mediaUrl !== null ? (
              <>
                <div
                  className="editor-video-stage"
                  style={{ aspectRatio: `${recording.width} / ${recording.height}` }}
                >
                  <video
                    ref={videoRef}
                    controls
                    playsInline
                    preload="metadata"
                    src={mediaUrl}
                    onLoadedMetadata={() => seekTo(trimStartMs)}
                    onTimeUpdate={(event) => {
                      const video = event.currentTarget;
                      const elapsed = Math.round(video.currentTime * 1_000);
                      if (elapsed >= trimEndMs) {
                        video.pause();
                        video.currentTime = trimEndMs / 1_000;
                        setCurrentMs(trimEndMs);
                        return;
                      }
                      setCurrentMs(elapsed);
                      video.muted = mutedRanges.some(
                        (range) => elapsed >= range.startMs && elapsed < range.endMs,
                      );
                    }}
                  />
                  <div
                    aria-hidden="true"
                    className="editor-crop-overlay"
                    style={{
                      height: `${crop.height * 100}%`,
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                    }}
                  />
                  {rotation !== 0 && (
                    <div className="editor-rotation-badge">Export rotation · {rotation}°</div>
                  )}
                </div>
                <div className="editor-playhead-row">
                  <strong>{formatEditorTime(currentMs)}</strong>
                  <input
                    aria-label="Editor playhead"
                    max={trimEndMs}
                    min={trimStartMs}
                    step={100}
                    type="range"
                    value={currentMs}
                    onChange={(event) => seekTo(Number(event.target.value))}
                  />
                  <span>{formatEditorTime(trimEndMs)}</span>
                </div>
              </>
            ) : null}
          </SurfaceCard>

          <SurfaceCard className="editor-timeline-card">
            <div className="editor-section-heading">
              <div>
                <span>Timeline</span>
                <h3>Trim and mute</h3>
              </div>
              <span>{formatEditorTime(trimEndMs - trimStartMs)} output</span>
            </div>
            <div className="editor-range-pair">
              <label>
                <span>In · {formatEditorTime(trimStartMs)}</span>
                <input
                  max={Math.max(0, trimEndMs - 100)}
                  min={0}
                  step={100}
                  type="range"
                  value={trimStartMs}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setTrimStartMs(value);
                    if (posterTimeMs < value) setPosterTimeMs(value);
                    if (currentMs < value) seekTo(value);
                    setMutedRanges((ranges) => ranges.filter((range) => range.startMs >= value));
                  }}
                />
              </label>
              <label>
                <span>Out · {formatEditorTime(trimEndMs)}</span>
                <input
                  max={recording.durationMs}
                  min={trimStartMs + 100}
                  step={100}
                  type="range"
                  value={trimEndMs}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setTrimEndMs(value);
                    if (posterTimeMs > value) setPosterTimeMs(value);
                    if (currentMs > value) seekTo(value);
                    setMutedRanges((ranges) => ranges.filter((range) => range.endMs <= value));
                  }}
                />
              </label>
            </div>
            <div className="editor-marker-actions">
              <Button
                disabled={currentMs >= trimEndMs}
                variant={muteStartMs === null ? 'secondary' : 'primary'}
                onClick={toggleMuteMarker}
              >
                {muteStartMs === null ? 'Start mute at playhead' : 'Finish mute range'}
              </Button>
              {muteStartMs !== null && (
                <Button variant="ghost" onClick={() => setMuteStartMs(null)}>
                  Cancel marker
                </Button>
              )}
              <Button variant="ghost" onClick={() => setPosterTimeMs(currentMs)}>
                Use playhead as thumbnail
              </Button>
            </div>
            <div className="editor-markers">
              <span className="editor-poster-marker">
                Thumbnail · {formatEditorTime(posterTimeMs)}
              </span>
              {mutedRanges.map((range, index) => (
                <button
                  key={`${range.startMs}-${range.endMs}`}
                  type="button"
                  onClick={() =>
                    setMutedRanges((ranges) => ranges.filter((_, candidate) => candidate !== index))
                  }
                >
                  Muted {formatEditorTime(range.startMs)}–{formatEditorTime(range.endMs)} ×
                </button>
              ))}
            </div>
          </SurfaceCard>
        </div>

        <aside className="editor-controls-column">
          <SurfaceCard className="editor-control-card">
            <div className="editor-section-heading">
              <div>
                <span>Export</span>
                <h3>Recording details</h3>
              </div>
            </div>
            <label className="field">
              <span>Name</span>
              <input
                maxLength={180}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="editor-output-summary">
              <span>Output</span>
              <strong>
                {dimensions.width} × {dimensions.height}
              </strong>
              <small>
                {recording.codec === 'prores422' ? 'ProRes 422' : recording.codec.toUpperCase()} ·{' '}
                {recording.frameRate} FPS
              </small>
            </div>
          </SurfaceCard>

          <SurfaceCard className="editor-control-card">
            <div className="editor-section-heading">
              <div>
                <span>Frame</span>
                <h3>Crop</h3>
              </div>
            </div>
            <div className="editor-preset-grid">
              <Button variant="secondary" onClick={() => setCropPreset(null)}>
                Original
              </Button>
              <Button variant="secondary" onClick={() => setCropPreset(16 / 9)}>
                16:9
              </Button>
              <Button variant="secondary" onClick={() => setCropPreset(4 / 3)}>
                4:3
              </Button>
              <Button variant="secondary" onClick={() => setCropPreset(1)}>
                Square
              </Button>
            </div>
            <CropSlider
              label="Left"
              value={crop.x}
              max={1 - crop.width}
              onChange={(x) => updateCrop({ x })}
            />
            <CropSlider
              label="Top"
              value={crop.y}
              max={1 - crop.height}
              onChange={(y) => updateCrop({ y })}
            />
            <CropSlider
              label="Width"
              value={crop.width}
              min={0.02}
              max={1 - crop.x}
              onChange={(width) => updateCrop({ width })}
            />
            <CropSlider
              label="Height"
              value={crop.height}
              min={0.02}
              max={1 - crop.y}
              onChange={(height) => updateCrop({ height })}
            />
          </SurfaceCard>

          <SurfaceCard className="editor-control-card">
            <div className="editor-section-heading">
              <div>
                <span>Orientation</span>
                <h3>Rotate</h3>
              </div>
            </div>
            <div className="editor-preset-grid editor-rotation-grid">
              {([0, 90, 180, 270] as const).map((value) => (
                <Button
                  key={value}
                  aria-pressed={rotation === value}
                  variant={rotation === value ? 'primary' : 'secondary'}
                  onClick={() => setRotation(value)}
                >
                  {value}°
                </Button>
              ))}
            </div>
          </SurfaceCard>
        </aside>
      </div>
    </div>
  );
}

function CropSlider({
  label,
  value,
  min = 0,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}): ReactElement {
  return (
    <label className="editor-crop-slider">
      <span>
        {label}
        <strong>{Math.round(value * 100)}%</strong>
      </span>
      <input
        min={min}
        max={Math.max(min, max)}
        step={0.01}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
