import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { RecordingEditRequestDto, RecordingMetadataDto } from '@screen-recorder/contracts';

import { Button, EmptyState, Icon, LoadingState } from '../app/components';
import { useRendererSelector, type RendererStore } from '../app/renderer-store';
import {
  centeredCropForAspect,
  formatEditorTime,
  outputDimensions,
  type CropRect,
} from './editor-model';

type Rotation = RecordingEditRequestDto['rotation'];
type MuteRange = RecordingEditRequestDto['mutedRanges'][number];
type InspectorTab = 'frame' | 'export';

const originalCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const minimumRangeMs = 100;
const timelineLabelWidthPx = 72;

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
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [title, setTitle] = useState(`${recording.title || 'Untitled recording'} – Edited`);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(recording.durationMs);
  const [currentMs, setCurrentMs] = useState(0);
  const [crop, setCrop] = useState<CropRect>(originalCrop);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [mutedRanges, setMutedRanges] = useState<MuteRange[]>([]);
  const [posterTimeMs, setPosterTimeMs] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('frame');

  const dimensions = useMemo(
    () => outputDimensions(recording, crop, rotation),
    [crop, recording, rotation],
  );
  const exporting = operation === 'exporting-edit';
  const hasAudio = recording.hasSystemAudio || recording.hasMicrophone;

  useEffect(() => {
    let active = true;
    void Promise.all([
      store.getRecordingMediaUrl(recording.id),
      store.getRecordingThumbnail(recording.id).catch(() => null),
    ])
      .then(([url, thumbnail]) => {
        if (!active) return;
        setMediaUrl(url);
        setThumbnailUrl(thumbnail);
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
    const next = Math.min(recording.durationMs, Math.max(0, milliseconds));
    setCurrentMs(next);
    if (videoRef.current !== null) {
      videoRef.current.currentTime = next / 1_000;
      videoRef.current.muted = mutedRanges.some(
        (range) => next >= range.startMs && next < range.endMs,
      );
    }
  }

  async function togglePlayback(): Promise<void> {
    const video = videoRef.current;
    if (video === null) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (currentMs < trimStartMs || currentMs >= trimEndMs) seekTo(trimStartMs);
    try {
      await video.play();
    } catch {
      setLocalError('Preview playback could not start.');
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select') === true) return;
      if (event.code === 'Space') {
        event.preventDefault();
        void togglePlayback();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekTo(currentMs - (event.shiftKey ? 5_000 : 500));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekTo(currentMs + (event.shiftKey ? 5_000 : 500));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

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

  function updateTrimStart(value: number): void {
    const next = Math.min(trimEndMs - minimumRangeMs, Math.max(0, value));
    setTrimStartMs(next);
    if (posterTimeMs < next) setPosterTimeMs(next);
    setMutedRanges((ranges) => ranges.filter((range) => range.startMs >= next));
  }

  function updateTrimEnd(value: number): void {
    const next = Math.max(trimStartMs + minimumRangeMs, Math.min(recording.durationMs, value));
    setTrimEndMs(next);
    if (posterTimeMs > next) setPosterTimeMs(next);
    setMutedRanges((ranges) => ranges.filter((range) => range.endMs <= next));
  }

  function addMuteRange(atMs: number): void {
    if (!hasAudio) {
      setLocalError('This recording does not contain an audio track.');
      return;
    }
    const startMs = Math.max(trimStartMs, Math.min(trimEndMs - minimumRangeMs, atMs));
    const endMs = Math.min(trimEndMs, startMs + 1_000);
    if (endMs - startMs < minimumRangeMs) return;
    setMutedRanges((ranges) =>
      [...ranges, { startMs, endMs }].sort((left, right) => left.startMs - right.startMs),
    );
    setLocalError(null);
  }

  function updateMuteRange(index: number, next: MuteRange): void {
    // Keep array identity stable while dragging; the domain layer sorts and merges ranges on export.
    setMutedRanges((ranges) =>
      ranges.map((range, candidate) => (candidate === index ? next : range)),
    );
  }

  function removeMuteRange(index: number): void {
    setMutedRanges((ranges) => ranges.filter((_, candidate) => candidate !== index));
  }

  function updatePosterTime(value: number): void {
    setPosterTimeMs(Math.min(trimEndMs, Math.max(trimStartMs, value)));
  }

  function resetTimeline(): void {
    videoRef.current?.pause();
    setTrimStartMs(0);
    setTrimEndMs(recording.durationMs);
    setMutedRanges([]);
    setPosterTimeMs(0);
    seekTo(0);
  }

  async function exportEdit(): Promise<void> {
    if (title.trim().length === 0) {
      setLocalError('Enter a name for the edited recording.');
      return;
    }
    if (trimEndMs - trimStartMs < minimumRangeMs) {
      setLocalError('Keep at least 0.1 seconds in the edited recording.');
      return;
    }
    videoRef.current?.pause();
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
    <div className="editor-workspace editor-studio">
      <header className="editor-command-bar">
        <Button
          aria-label="Back to library"
          className="editor-back-button"
          disabled={exporting}
          icon="chevron-right"
          variant="icon"
          onClick={() => store.closeEditor()}
        />
        <div className="editor-project-identity">
          <span>Editing project</span>
          <input
            aria-label="Edited recording name"
            maxLength={180}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="editor-command-meta">
          <span>
            {dimensions.width} × {dimensions.height}
          </span>
          <span>{formatEditorTime(trimEndMs - trimStartMs)}</span>
        </div>
        <Button
          disabled={exporting || mediaUrl === null}
          icon="sparkles"
          variant="primary"
          onClick={() => void exportEdit()}
        >
          {exporting ? 'Exporting…' : 'Export'}
        </Button>
      </header>

      {(localError !== null || mediaError !== null) && (
        <div className="editor-inline-error" role="alert">
          {localError ?? mediaError}
        </div>
      )}

      <div className="editor-stage-layout">
        <main className="editor-canvas-panel">
          <div className="editor-canvas-toolbar">
            <span>Canvas</span>
            <div>
              <span>
                {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
              </span>
              {rotation !== 0 && <span>{rotation}° rotation</span>}
            </div>
          </div>
          <div className="editor-canvas-well">
            {mediaUrl === null && mediaError === null ? (
              <LoadingState label="Loading project" />
            ) : mediaUrl !== null ? (
              <div
                className="editor-video-stage"
                style={{ aspectRatio: `${recording.width} / ${recording.height}` }}
              >
                <video
                  ref={videoRef}
                  playsInline
                  preload="auto"
                  src={mediaUrl}
                  onCanPlay={() => setMediaError(null)}
                  onClick={() => void togglePlayback()}
                  onError={(event) => {
                    setPlaying(false);
                    const code = event.currentTarget.error?.code;
                    setMediaError(
                      `The editing preview could not be decoded${code === undefined ? '.' : ` (media error ${code}).`}`,
                    );
                  }}
                  onLoadedMetadata={() => seekTo(trimStartMs)}
                  onPause={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  onTimeUpdate={(event) => {
                    const video = event.currentTarget;
                    const elapsed = Math.round(video.currentTime * 1_000);
                    if (!video.paused && elapsed >= trimEndMs) {
                      video.pause();
                      seekTo(trimStartMs);
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
                {!playing && (
                  <button
                    aria-label="Play preview"
                    className="editor-canvas-play"
                    type="button"
                    onClick={() => void togglePlayback()}
                  >
                    <Icon name="play" size={25} />
                  </button>
                )}
              </div>
            ) : null}
          </div>
          <div className="editor-transport">
            <span className="editor-timecode">{formatEditorTime(currentMs)}</span>
            <div className="editor-transport-actions">
              <button type="button" onClick={() => seekTo(currentMs - 5_000)}>
                −5s
              </button>
              <button
                aria-label={playing ? 'Pause preview' : 'Play preview'}
                className="editor-transport-play"
                type="button"
                onClick={() => void togglePlayback()}
              >
                <Icon name={playing ? 'pause' : 'play'} size={18} />
              </button>
              <button type="button" onClick={() => seekTo(currentMs + 5_000)}>
                +5s
              </button>
            </div>
            <span className="editor-timecode editor-timecode-end">
              {formatEditorTime(recording.durationMs)}
            </span>
          </div>
        </main>

        <aside className="editor-inspector">
          <div className="editor-inspector-tabs" role="tablist" aria-label="Editor inspector">
            <button
              aria-selected={inspectorTab === 'frame'}
              role="tab"
              type="button"
              onClick={() => setInspectorTab('frame')}
            >
              Frame
            </button>
            <button
              aria-selected={inspectorTab === 'export'}
              role="tab"
              type="button"
              onClick={() => setInspectorTab('export')}
            >
              Export
            </button>
          </div>

          {inspectorTab === 'frame' ? (
            <div className="editor-inspector-content">
              <InspectorSection title="Aspect ratio">
                <div className="editor-segmented-control">
                  <button type="button" onClick={() => setCropPreset(null)}>
                    Original
                  </button>
                  <button type="button" onClick={() => setCropPreset(16 / 9)}>
                    16:9
                  </button>
                  <button type="button" onClick={() => setCropPreset(4 / 3)}>
                    4:3
                  </button>
                  <button type="button" onClick={() => setCropPreset(1)}>
                    1:1
                  </button>
                </div>
              </InspectorSection>
              <InspectorSection title="Crop">
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
              </InspectorSection>
              <InspectorSection title="Rotation">
                <div className="editor-segmented-control editor-rotation-control">
                  {([0, 90, 180, 270] as const).map((value) => (
                    <button
                      key={value}
                      aria-pressed={rotation === value}
                      className={rotation === value ? 'is-selected' : ''}
                      type="button"
                      onClick={() => setRotation(value)}
                    >
                      {value}°
                    </button>
                  ))}
                </div>
              </InspectorSection>
            </div>
          ) : (
            <div className="editor-inspector-content">
              <InspectorSection title="Project">
                <label className="editor-inspector-field">
                  <span>Name</span>
                  <input
                    value={title}
                    maxLength={180}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
              </InspectorSection>
              <InspectorSection title="Output">
                <dl className="editor-output-details">
                  <div>
                    <dt>Resolution</dt>
                    <dd>
                      {dimensions.width} × {dimensions.height}
                    </dd>
                  </div>
                  <div>
                    <dt>Codec</dt>
                    <dd>
                      {recording.codec === 'prores422'
                        ? 'ProRes 422'
                        : recording.codec.toUpperCase()}
                    </dd>
                  </div>
                  <div>
                    <dt>Frame rate</dt>
                    <dd>{recording.frameRate} FPS</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{formatEditorTime(trimEndMs - trimStartMs)}</dd>
                  </div>
                </dl>
              </InspectorSection>
              <p className="editor-inspector-note">
                The source remains untouched. Export creates a separate Library recording.
              </p>
            </div>
          )}
        </aside>
      </div>

      <TimelineEditor
        currentMs={currentMs}
        durationMs={recording.durationMs}
        hasAudio={hasAudio}
        mutedRanges={mutedRanges}
        playing={playing}
        posterTimeMs={posterTimeMs}
        thumbnailUrl={thumbnailUrl}
        trimEndMs={trimEndMs}
        trimStartMs={trimStartMs}
        onAddMute={addMuteRange}
        onPosterChange={updatePosterTime}
        onRemoveMute={removeMuteRange}
        onReset={resetTimeline}
        onSeek={seekTo}
        onTrimEndChange={updateTrimEnd}
        onTrimStartChange={updateTrimStart}
        onUpdateMute={updateMuteRange}
      />
    </div>
  );
}

function InspectorSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="editor-inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

type TimelineDrag =
  | { readonly type: 'playhead' }
  | { readonly type: 'poster' }
  | { readonly type: 'trim-start' }
  | { readonly type: 'trim-end' }
  | { readonly type: 'mute-start'; readonly index: number }
  | { readonly type: 'mute-end'; readonly index: number };

interface TimelineContext {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
  readonly muteIndex?: number;
}

interface TimelineEditorProps {
  readonly durationMs: number;
  readonly currentMs: number;
  readonly hasAudio: boolean;
  readonly trimStartMs: number;
  readonly trimEndMs: number;
  readonly posterTimeMs: number;
  readonly mutedRanges: readonly MuteRange[];
  readonly thumbnailUrl: string | null;
  readonly playing: boolean;
  readonly onSeek: (timeMs: number) => void;
  readonly onTrimStartChange: (timeMs: number) => void;
  readonly onTrimEndChange: (timeMs: number) => void;
  readonly onPosterChange: (timeMs: number) => void;
  readonly onAddMute: (timeMs: number) => void;
  readonly onUpdateMute: (index: number, range: MuteRange) => void;
  readonly onRemoveMute: (index: number) => void;
  readonly onReset: () => void;
}

function TimelineEditor(props: TimelineEditorProps): ReactElement {
  const {
    durationMs,
    currentMs,
    hasAudio,
    trimStartMs,
    trimEndMs,
    posterTimeMs,
    mutedRanges,
    thumbnailUrl,
    playing,
    onSeek,
    onTrimStartChange,
    onTrimEndChange,
    onPosterChange,
    onAddMute,
    onUpdateMute,
    onRemoveMute,
    onReset,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<TimelineDrag | null>(null);
  const [context, setContext] = useState<TimelineContext | null>(null);
  const safeDurationMs = Math.max(durationMs, 1);
  const tickCount = Math.max(10, Math.round(10 * zoom));
  const ticks = useMemo(
    () => Array.from({ length: tickCount + 1 }, (_, index) => (safeDurationMs * index) / tickCount),
    [safeDurationMs, tickCount],
  );
  const waveform = useMemo(
    () =>
      Array.from({ length: 128 }, (_, index) =>
        Math.round(18 + Math.abs(Math.sin(index * 0.71) * Math.cos(index * 0.17)) * 62),
      ),
    [],
  );
  const percentage = (timeMs: number): number =>
    Math.min(100, Math.max(0, (timeMs / safeDurationMs) * 100));

  function timeAt(clientX: number): number {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (bounds === undefined || bounds.width <= timelineLabelWidthPx) return 0;
    const timelineX = clientX - bounds.left - timelineLabelWidthPx;
    return Math.min(
      safeDurationMs,
      Math.max(0, (timelineX / (bounds.width - timelineLabelWidthPx)) * safeDurationMs),
    );
  }

  function timelinePosition(timeMs: number): string {
    const ratio = Math.min(1, Math.max(0, timeMs / safeDurationMs));
    return `calc(${ratio * 100}% + ${timelineLabelWidthPx * (1 - ratio)}px)`;
  }

  useEffect(() => {
    if (drag === null) return undefined;
    const handleMove = (event: PointerEvent): void => {
      const timeMs = Math.round(timeAt(event.clientX) / 10) * 10;
      if (drag.type === 'playhead') onSeek(timeMs);
      else if (drag.type === 'poster') onPosterChange(timeMs);
      else if (drag.type === 'trim-start') onTrimStartChange(timeMs);
      else if (drag.type === 'trim-end') onTrimEndChange(timeMs);
      else {
        const range = mutedRanges[drag.index];
        if (range === undefined) return;
        if (drag.type === 'mute-start') {
          onUpdateMute(drag.index, {
            startMs: Math.min(range.endMs - minimumRangeMs, Math.max(trimStartMs, timeMs)),
            endMs: range.endMs,
          });
        } else {
          onUpdateMute(drag.index, {
            startMs: range.startMs,
            endMs: Math.max(range.startMs + minimumRangeMs, Math.min(trimEndMs, timeMs)),
          });
        }
      }
    };
    const handleUp = (): void => setDrag(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [
    drag,
    mutedRanges,
    onSeek,
    onPosterChange,
    onTrimEndChange,
    onTrimStartChange,
    onUpdateMute,
    trimEndMs,
    trimStartMs,
  ]);

  useEffect(() => {
    if (!playing || zoom <= 1) return;
    const scroll = scrollRef.current;
    if (scroll === null) return;
    const playheadX =
      timelineLabelWidthPx +
      (currentMs / safeDurationMs) * (scroll.scrollWidth - timelineLabelWidthPx);
    if (
      playheadX < scroll.scrollLeft + 30 ||
      playheadX > scroll.scrollLeft + scroll.clientWidth - 30
    ) {
      scroll.scrollTo({ left: Math.max(0, playheadX - scroll.clientWidth / 2) });
    }
  }, [currentMs, playing, safeDurationMs, zoom]);

  useEffect(() => {
    if (context === null) return undefined;
    const close = (): void => setContext(null);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [context]);

  function openContextMenu(event: ReactMouseEvent, muteIndex?: number): void {
    event.preventDefault();
    event.stopPropagation();
    setContext({
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.min(event.clientY, window.innerHeight - 270),
      timeMs: timeAt(event.clientX),
      ...(muteIndex === undefined ? {} : { muteIndex }),
    });
  }

  function runContext(action: () => void): void {
    action();
    setContext(null);
  }

  const clipLeft = percentage(trimStartMs);
  const clipWidth = Math.max(0.5, percentage(trimEndMs) - clipLeft);

  return (
    <section className="editor-timeline-panel" aria-label="Editing timeline">
      <div className="editor-timeline-toolbar">
        <div className="editor-timeline-title">
          <strong>Timeline</strong>
          <span>Right-click a clip or audio range for actions</span>
        </div>
        <div className="editor-timeline-tools">
          <button type="button" onClick={() => onTrimStartChange(currentMs)}>
            Set In
          </button>
          <button type="button" onClick={() => onTrimEndChange(currentMs)}>
            Set Out
          </button>
          <button disabled={!hasAudio} type="button" onClick={() => onAddMute(currentMs)}>
            Mute range
          </button>
          <button type="button" onClick={() => onPosterChange(currentMs)}>
            Set thumbnail
          </button>
          <label className="editor-timeline-zoom">
            <span>−</span>
            <input
              aria-label="Timeline zoom"
              max={4}
              min={1}
              step={0.25}
              type="range"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span>+</span>
          </label>
        </div>
      </div>

      <div ref={scrollRef} className="editor-timeline-scroll">
        <div
          ref={canvasRef}
          className={`editor-timeline-canvas ${drag !== null ? 'is-dragging' : ''}`}
          style={{ width: `${zoom * 100}%` }}
          onContextMenu={(event) => openContextMenu(event)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            onSeek(timeAt(event.clientX));
            setDrag({ type: 'playhead' });
          }}
        >
          <div className="editor-timeline-ruler">
            {ticks.map((timeMs, index) => (
              <div
                key={index}
                className="editor-ruler-tick"
                style={{ left: `${(index / tickCount) * 100}%` }}
              >
                <i />
                {index % 2 === 0 && <span>{formatEditorTime(timeMs)}</span>}
              </div>
            ))}
          </div>

          <TimelineTrack label="Screen" icon="monitor">
            <div
              className="editor-video-clip"
              style={{ left: `${clipLeft}%`, width: `${clipWidth}%` }}
              onContextMenu={(event) => openContextMenu(event)}
            >
              <TimelineHandle
                label="Adjust trim start"
                side="start"
                onStart={() => setDrag({ type: 'trim-start' })}
              />
              <div className="editor-filmstrip" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) =>
                  thumbnailUrl === null ? (
                    <span key={index} />
                  ) : (
                    <img key={index} alt="" draggable={false} src={thumbnailUrl} />
                  ),
                )}
              </div>
              <span className="editor-clip-name">Screen recording</span>
              <TimelineHandle
                label="Adjust trim end"
                side="end"
                onStart={() => setDrag({ type: 'trim-end' })}
              />
            </div>
          </TimelineTrack>

          <TimelineTrack label="Audio" icon="activity">
            {hasAudio ? (
              <div
                className="editor-audio-clip"
                style={{ left: `${clipLeft}%`, width: `${clipWidth}%` }}
                onContextMenu={(event) => openContextMenu(event)}
              >
                <div className="editor-waveform" aria-hidden="true">
                  {waveform.map((height, index) => (
                    <i key={index} style={{ height: `${height}%` }} />
                  ))}
                </div>
              </div>
            ) : (
              <span className="editor-empty-audio">No audio track</span>
            )}
            {hasAudio &&
              mutedRanges.map((range, index) => (
                <div
                  key={`${range.startMs}-${range.endMs}-${index}`}
                  className="editor-mute-block"
                  style={{
                    left: `${percentage(range.startMs)}%`,
                    width: `${Math.max(0.35, percentage(range.endMs) - percentage(range.startMs))}%`,
                  }}
                  onContextMenu={(event) => openContextMenu(event, index)}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <TimelineHandle
                    range
                    label="Adjust mute start"
                    side="start"
                    onStart={() => setDrag({ type: 'mute-start', index })}
                  />
                  <span>Muted</span>
                  <TimelineHandle
                    range
                    label="Adjust mute end"
                    side="end"
                    onStart={() => setDrag({ type: 'mute-end', index })}
                  />
                </div>
              ))}
          </TimelineTrack>

          <button
            aria-label={`Thumbnail at ${formatEditorTime(posterTimeMs)}`}
            className="editor-poster-pin"
            style={{ left: timelinePosition(posterTimeMs) }}
            title="Library thumbnail"
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
              onSeek(posterTimeMs);
              setDrag({ type: 'poster' });
            }}
          >
            <Icon name="sparkles" size={11} />
          </button>
          <button
            aria-label={`Playhead at ${formatEditorTime(currentMs)}`}
            className="editor-playhead"
            style={{ left: timelinePosition(currentMs) }}
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
              setDrag({ type: 'playhead' });
            }}
          >
            <span />
          </button>
        </div>
      </div>

      {context !== null && (
        <div
          className="editor-context-menu"
          role="menu"
          style={{ left: context.x, top: context.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="editor-context-heading">{formatEditorTime(context.timeMs)}</div>
          {context.muteIndex === undefined ? (
            <>
              <ContextAction
                label="Move playhead here"
                onSelect={() => runContext(() => onSeek(context.timeMs))}
              />
              <ContextAction
                label="Set trim start here"
                onSelect={() => runContext(() => onTrimStartChange(context.timeMs))}
              />
              <ContextAction
                label="Set trim end here"
                onSelect={() => runContext(() => onTrimEndChange(context.timeMs))}
              />
              {hasAudio && (
                <ContextAction
                  label="Add 1-second mute"
                  onSelect={() => runContext(() => onAddMute(context.timeMs))}
                />
              )}
              <ContextAction
                label="Use frame as thumbnail"
                onSelect={() => runContext(() => onPosterChange(context.timeMs))}
              />
              <ContextAction
                danger
                label="Reset timeline edits"
                onSelect={() => runContext(onReset)}
              />
            </>
          ) : (
            <MuteContextActions
              context={context}
              currentMs={currentMs}
              mutedRanges={mutedRanges}
              trimEndMs={trimEndMs}
              trimStartMs={trimStartMs}
              onRemoveMute={onRemoveMute}
              onRun={runContext}
              onSeek={onSeek}
              onUpdateMute={onUpdateMute}
            />
          )}
        </div>
      )}
    </section>
  );
}

function TimelineTrack({
  label,
  icon,
  children,
}: {
  readonly label: string;
  readonly icon: 'monitor' | 'activity';
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="editor-timeline-track-row">
      <div className="editor-track-label">
        <Icon name={icon} size={14} />
        <span>{label}</span>
      </div>
      <div className="editor-track-lane">{children}</div>
    </div>
  );
}

function TimelineHandle({
  label,
  side,
  range = false,
  onStart,
}: {
  readonly label: string;
  readonly side: 'start' | 'end';
  readonly range?: boolean;
  readonly onStart: () => void;
}): ReactElement {
  return (
    <button
      aria-label={label}
      className={`${range ? 'editor-range-handle' : 'editor-trim-handle'} is-${side}`}
      type="button"
      onPointerDown={(event) => {
        event.stopPropagation();
        onStart();
      }}
    >
      <span />
    </button>
  );
}

function MuteContextActions({
  context,
  currentMs,
  mutedRanges,
  trimStartMs,
  trimEndMs,
  onRun,
  onSeek,
  onUpdateMute,
  onRemoveMute,
}: {
  readonly context: TimelineContext & { readonly muteIndex?: number };
  readonly currentMs: number;
  readonly mutedRanges: readonly MuteRange[];
  readonly trimStartMs: number;
  readonly trimEndMs: number;
  readonly onRun: (action: () => void) => void;
  readonly onSeek: (timeMs: number) => void;
  readonly onUpdateMute: (index: number, range: MuteRange) => void;
  readonly onRemoveMute: (index: number) => void;
}): ReactElement {
  const index = context.muteIndex ?? -1;
  const range = mutedRanges[index];
  return (
    <>
      <ContextAction
        label="Go to mute start"
        onSelect={() => onRun(() => onSeek(range?.startMs ?? context.timeMs))}
      />
      <ContextAction
        label="Set start to playhead"
        onSelect={() =>
          onRun(() => {
            if (range !== undefined && currentMs < range.endMs - minimumRangeMs)
              onUpdateMute(index, {
                startMs: Math.max(trimStartMs, currentMs),
                endMs: range.endMs,
              });
          })
        }
      />
      <ContextAction
        label="Set end to playhead"
        onSelect={() =>
          onRun(() => {
            if (range !== undefined && currentMs > range.startMs + minimumRangeMs)
              onUpdateMute(index, {
                startMs: range.startMs,
                endMs: Math.min(trimEndMs, currentMs),
              });
          })
        }
      />
      <ContextAction
        danger
        label="Remove mute range"
        onSelect={() => onRun(() => onRemoveMute(index))}
      />
    </>
  );
}

function ContextAction({
  label,
  danger = false,
  onSelect,
}: {
  readonly label: string;
  readonly danger?: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  return (
    <button className={danger ? 'is-danger' : ''} role="menuitem" type="button" onClick={onSelect}>
      {label}
    </button>
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
