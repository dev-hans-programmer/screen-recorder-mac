import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import type {
  EditingProjectDto,
  RecordingEditRequestDto,
  RecordingMetadataDto,
} from '@screen-recorder/contracts';

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
const timelineLabelWidthPx = 184;

function trackKindLabel(kind: EditingProjectDto['tracks'][number]['kind']): string {
  switch (kind) {
    case 'screen':
      return 'Screen';
    case 'webcam':
      return 'Webcam';
    case 'microphone':
      return 'Microphone';
    case 'system-audio':
      return 'System audio';
    case 'music':
      return 'Music';
    case 'captions':
      return 'Captions';
    case 'overlays':
      return 'Overlays';
  }
}

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
  const canvasPanelRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [project, setProject] = useState<EditingProjectDto | null>(null);
  const [projectSaveState, setProjectSaveState] = useState<
    'loading' | 'saved' | 'saving' | 'error'
  >('loading');
  const projectSaveTimerRef = useRef<number | null>(null);
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('frame');
  const projectSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const queueProjectSave = useCallback(
    (candidate: EditingProjectDto): Promise<EditingProjectDto> => {
      const save = projectSaveQueueRef.current.then(() => store.saveEditingProject(candidate));
      projectSaveQueueRef.current = save.then(
        () => undefined,
        () => undefined,
      );
      return save;
    },
    [store],
  );

  const dimensions = useMemo(
    () => outputDimensions(recording, crop, rotation),
    [crop, recording, rotation],
  );
  const outputDurationMs =
    project?.tracks
      .filter((track) => ['screen', 'microphone', 'system-audio', 'music'].includes(track.kind))
      .flatMap((track) => track.clips)
      .reduce(
        (latestEnd, clip) => Math.max(latestEnd, clip.timelineStartMs + clip.durationMs),
        0,
      ) || trimEndMs - trimStartMs;
  const exporting = operation === 'exporting-edit';
  const hasAudio = recording.hasSystemAudio || recording.hasMicrophone;
  const screenTrack = project?.tracks.find((track) => track.kind === 'screen');
  const screenClip = screenTrack?.clips[0];
  const screenFrameActive =
    screenClip === undefined ||
    (currentMs >= screenClip.timelineStartMs &&
      currentMs <= screenClip.timelineStartMs + screenClip.durationMs);

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

  useEffect(() => {
    let active = true;
    void store
      .loadEditingProject(recording.id)
      .then((loaded) => {
        if (!active) return;
        setProject(loaded);
        setTitle(loaded.title);
        const screenClip = loaded.tracks.find((track) => track.kind === 'screen')?.clips.at(0);
        if (screenClip !== undefined) {
          setTrimStartMs(screenClip.sourceStartMs);
          setTrimEndMs(
            Math.min(recording.durationMs, screenClip.sourceStartMs + screenClip.durationMs),
          );
        }
        setProjectSaveState('saved');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProjectSaveState('error');
        setLocalError(
          error instanceof Error ? error.message : 'The editing project could not load.',
        );
      });
    return () => {
      active = false;
    };
  }, [recording.durationMs, recording.id, store]);

  useEffect(() => {
    if (project === null) return undefined;
    setProjectSaveState('saving');
    const timer = window.setTimeout(() => {
      projectSaveTimerRef.current = null;
      void queueProjectSave(project)
        .then(() => setProjectSaveState('saved'))
        .catch(() => setProjectSaveState('error'));
    }, 400);
    projectSaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (projectSaveTimerRef.current === timer) projectSaveTimerRef.current = null;
    };
  }, [project, queueProjectSave]);

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      setIsFullscreen(document.fullscreenElement === canvasPanelRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null || mediaUrl === null || playing) return;
    if (
      screenClip !== undefined &&
      currentMs >= screenClip.timelineStartMs &&
      currentMs <= screenClip.timelineStartMs + screenClip.durationMs
    ) {
      const sourceTimeMs = screenClip.sourceStartMs + currentMs - screenClip.timelineStartMs;
      if (Math.abs(video.currentTime * 1_000 - sourceTimeMs) > 80) {
        video.currentTime = sourceTimeMs / 1_000;
      }
    }
  }, [
    currentMs,
    mediaUrl,
    playing,
    screenClip?.durationMs,
    screenClip?.sourceStartMs,
    screenClip?.timelineStartMs,
  ]);

  function seekTo(milliseconds: number): void {
    const next = Math.min(recording.durationMs, Math.max(0, milliseconds));
    setCurrentMs(next);
    if (videoRef.current !== null) {
      const clip = screenClip;
      const clipOffsetMs = clip === undefined ? next : next - clip.timelineStartMs;
      const insideClip =
        clip === undefined || (clipOffsetMs >= 0 && clipOffsetMs <= clip.durationMs);
      if (insideClip) {
        videoRef.current.currentTime =
          (clip === undefined ? next : clip.sourceStartMs + clipOffsetMs) / 1_000;
      } else {
        videoRef.current.pause();
      }
      const audioTracks =
        project?.tracks.filter(
          (track) =>
            (track.kind === 'microphone' ||
              track.kind === 'system-audio' ||
              track.kind === 'music') &&
            track.clips.length > 0,
        ) ?? [];
      videoRef.current.muted =
        (audioTracks.length > 0 && audioTracks.every((track) => track.muted)) ||
        mutedRanges.some((range) => next >= range.startMs && next < range.endMs);
    }
  }

  async function togglePlayback(): Promise<void> {
    const video = videoRef.current;
    if (video === null) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    const clip = screenClip;
    const insideClip =
      clip === undefined ||
      (currentMs >= clip.timelineStartMs && currentMs < clip.timelineStartMs + clip.durationMs);
    if (!insideClip) seekTo(clip?.timelineStartMs ?? trimStartMs);
    try {
      await video.play();
    } catch {
      setLocalError('Preview playback could not start.');
    }
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement === canvasPanelRef.current) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await canvasPanelRef.current?.requestFullscreen();
        setIsFullscreen(true);
      }
      setLocalError(null);
    } catch {
      setLocalError('Fullscreen playback could not start.');
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
      } else if (event.key === 'Escape') {
        setIsFullscreen(false);
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
  }

  function updateTrimEnd(value: number): void {
    const next = Math.max(trimStartMs + minimumRangeMs, Math.min(recording.durationMs, value));
    setTrimEndMs(next);
    if (posterTimeMs > next) setPosterTimeMs(next);
  }

  function addMuteRange(atMs: number): void {
    if (!hasAudio) {
      setLocalError('This recording does not contain an audio track.');
      return;
    }
    const projectDurationMs = project?.durationMs ?? recording.durationMs;
    const startMs = Math.max(0, Math.min(projectDurationMs - minimumRangeMs, atMs));
    const endMs = Math.min(projectDurationMs, startMs + 1_000);
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

  function sourceTimeAtTimeline(timelineMs: number): number {
    if (screenClip === undefined) return timelineMs;
    return Math.min(
      screenClip.sourceStartMs + screenClip.durationMs,
      Math.max(
        screenClip.sourceStartMs,
        screenClip.sourceStartMs + timelineMs - screenClip.timelineStartMs,
      ),
    );
  }

  function updatePosterTimeAtTimeline(timelineMs: number): void {
    updatePosterTime(sourceTimeAtTimeline(timelineMs));
  }

  function resetTimeline(): void {
    videoRef.current?.pause();
    setTrimStartMs(0);
    setTrimEndMs(recording.durationMs);
    setMutedRanges([]);
    setPosterTimeMs(0);
    seekTo(0);
  }

  function updateTrack(trackId: string, patch: Partial<EditingProjectDto['tracks'][number]>): void {
    setProject((current) =>
      current === null
        ? current
        : {
            ...current,
            updatedAt: Date.now(),
            tracks: current.tracks.map((track) =>
              track.id === trackId ? { ...track, ...patch } : track,
            ),
          },
    );
  }

  function addTrack(kind: EditingProjectDto['tracks'][number]['kind']): void {
    setProject((current) => {
      if (current === null) return current;
      const sameKind = current.tracks.filter((track) => track.kind === kind).length;
      const baseName = trackKindLabel(kind);
      return {
        ...current,
        updatedAt: Date.now(),
        tracks: [
          ...current.tracks,
          {
            id: crypto.randomUUID(),
            kind,
            name: sameKind === 0 ? baseName : `${baseName} ${sameKind + 1}`,
            order: current.tracks.length,
            visible: true,
            muted: false,
            locked: false,
            gain: 1,
            clips: [],
          },
        ],
      };
    });
  }

  function removeTrack(trackId: string): void {
    setProject((current) => {
      if (current === null) return current;
      const target = current.tracks.find((track) => track.id === trackId);
      if (target === undefined || target.clips.length > 0 || target.kind === 'screen')
        return current;
      return {
        ...current,
        updatedAt: Date.now(),
        tracks: current.tracks
          .filter((track) => track.id !== trackId)
          .map((track, order) => ({ ...track, order })),
      };
    });
  }

  function moveTrack(trackId: string, delta: -1 | 1): void {
    setProject((current) => {
      if (current === null) return current;
      const tracks = [...current.tracks].sort((left, right) => left.order - right.order);
      const index = tracks.findIndex((track) => track.id === trackId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= tracks.length) return current;
      [tracks[index], tracks[nextIndex]] = [tracks[nextIndex], tracks[index]];
      return {
        ...current,
        updatedAt: Date.now(),
        tracks: tracks.map((track, order) => ({ ...track, order })),
      };
    });
  }

  function moveClip(trackId: string, clipId: string, timelineStartMs: number): void {
    setProject((current) => {
      if (current === null) return current;
      const track = current.tracks.find((candidate) => candidate.id === trackId);
      const clip = track?.clips.find((candidate) => candidate.id === clipId);
      if (track === undefined || clip === undefined || track.locked) return current;
      const latestStartMs = Math.max(0, current.durationMs - clip.durationMs);
      const nextStartMs =
        Math.round(Math.min(latestStartMs, Math.max(0, timelineStartMs)) / 10) * 10;
      return {
        ...current,
        updatedAt: Date.now(),
        tracks: current.tracks.map((candidate) =>
          candidate.id !== trackId
            ? candidate
            : {
                ...candidate,
                clips: candidate.clips.map((clip) =>
                  clip.id === clipId ? { ...clip, timelineStartMs: nextStartMs } : clip,
                ),
              },
        ),
      };
    });
  }

  function updateProjectTitle(nextTitle: string): void {
    setTitle(nextTitle);
    setProject((current) =>
      current === null ? current : { ...current, title: nextTitle, updatedAt: Date.now() },
    );
  }

  useEffect(() => {
    if (project === null) return;
    setProject((current) =>
      current === null
        ? current
        : {
            ...current,
            tracks: current.tracks.map((track) =>
              !['screen', 'microphone', 'system-audio'].includes(track.kind) ||
              track.clips.length === 0
                ? track
                : {
                    ...track,
                    clips: track.clips.map((clip, index) =>
                      index === 0
                        ? {
                            ...clip,
                            sourceStartMs: trimStartMs,
                            durationMs: trimEndMs - trimStartMs,
                          }
                        : clip,
                    ),
                  },
            ),
          },
    );
  }, [project === null, trimEndMs, trimStartMs]);

  async function exportEdit(): Promise<void> {
    if (project === null) {
      setLocalError('Wait for the editing project to finish loading before exporting.');
      return;
    }
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
    const projectForExport = { ...project, title };
    try {
      if (projectSaveTimerRef.current !== null) {
        window.clearTimeout(projectSaveTimerRef.current);
        projectSaveTimerRef.current = null;
      }
      setProjectSaveState('saving');
      await queueProjectSave(projectForExport);
      setProjectSaveState('saved');
      await store.exportEditedRecording({
        recordingId: recording.id,
        title,
        trimStartMs,
        trimEndMs,
        crop,
        rotation,
        mutedRanges,
        posterTimeMs: Math.min(trimEndMs, Math.max(trimStartMs, posterTimeMs)),
        project: projectForExport,
      });
    } catch (error) {
      setProjectSaveState('error');
      setLocalError(error instanceof Error ? error.message : 'The editing project could not save.');
    }
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
            onChange={(event) => updateProjectTitle(event.target.value)}
          />
        </div>
        <div className="editor-command-meta">
          <span>
            {dimensions.width} × {dimensions.height}
          </span>
          <span>{formatEditorTime(outputDurationMs)}</span>
        </div>
        <Button
          disabled={
            exporting || mediaUrl === null || project === null || projectSaveState === 'loading'
          }
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
        <main ref={canvasPanelRef} className="editor-canvas-panel">
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
                  style={{
                    visibility:
                      screenTrack?.visible === false || !screenFrameActive ? 'hidden' : 'visible',
                  }}
                  onCanPlay={() => setMediaError(null)}
                  onClick={() => void togglePlayback()}
                  onError={(event) => {
                    setPlaying(false);
                    const code = event.currentTarget.error?.code;
                    setMediaError(
                      `The editing preview could not be decoded${code === undefined ? '.' : ` (media error ${code}).`}`,
                    );
                  }}
                  onLoadedMetadata={() => seekTo(screenClip?.timelineStartMs ?? trimStartMs)}
                  onPause={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  onTimeUpdate={(event) => {
                    const video = event.currentTarget;
                    const clip = screenClip;
                    const sourceElapsed = Math.round(video.currentTime * 1_000);
                    const elapsed =
                      clip === undefined
                        ? sourceElapsed
                        : sourceElapsed - clip.sourceStartMs + clip.timelineStartMs;
                    const clipEndMs =
                      clip === undefined ? trimEndMs : clip.sourceStartMs + clip.durationMs;
                    if (!video.paused && sourceElapsed >= clipEndMs) {
                      video.pause();
                      seekTo(clip?.timelineStartMs ?? trimStartMs);
                      return;
                    }
                    setCurrentMs(elapsed);
                    const audioTracks =
                      project?.tracks.filter(
                        (track) =>
                          (track.kind === 'microphone' ||
                            track.kind === 'system-audio' ||
                            track.kind === 'music') &&
                          track.clips.length > 0,
                      ) ?? [];
                    video.muted =
                      (audioTracks.length > 0 && audioTracks.every((track) => track.muted)) ||
                      mutedRanges.some(
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
            <div className="editor-transport-end">
              <span className="editor-timecode editor-timecode-end">
                {formatEditorTime(recording.durationMs)}
              </span>
              <button
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                className="editor-fullscreen-button"
                title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                type="button"
                onClick={() => void toggleFullscreen()}
              >
                <Icon name={isFullscreen ? 'fullscreen-exit' : 'fullscreen'} size={17} />
              </button>
            </div>
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
                    onChange={(event) => updateProjectTitle(event.target.value)}
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
                    <dd>{formatEditorTime(outputDurationMs)}</dd>
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
        projectSaveState={projectSaveState}
        tracks={project?.tracks ?? []}
        mutedRanges={mutedRanges}
        playing={playing}
        posterTimeMs={posterTimeMs}
        thumbnailUrl={thumbnailUrl}
        trimEndMs={trimEndMs}
        trimStartMs={trimStartMs}
        onAddMute={addMuteRange}
        onAddTrack={addTrack}
        onMoveTrack={moveTrack}
        onMoveClip={moveClip}
        onPosterChange={updatePosterTimeAtTimeline}
        onRemoveTrack={removeTrack}
        onRemoveMute={removeMuteRange}
        onReset={resetTimeline}
        onSeek={seekTo}
        onTrackChange={updateTrack}
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
  | {
      readonly type: 'trim-start' | 'trim-end';
      readonly clipTimelineStartMs: number;
      readonly clipSourceStartMs: number;
    }
  | { readonly type: 'mute-start'; readonly index: number }
  | { readonly type: 'mute-end'; readonly index: number }
  | {
      readonly type: 'clip-move';
      readonly trackId: string;
      readonly clipId: string;
      readonly startX: number;
      readonly originalStartMs: number;
      readonly clipDurationMs: number;
    };

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
  readonly tracks: EditingProjectDto['tracks'];
  readonly projectSaveState: 'loading' | 'saved' | 'saving' | 'error';
  readonly onSeek: (timeMs: number) => void;
  readonly onTrimStartChange: (timeMs: number) => void;
  readonly onTrimEndChange: (timeMs: number) => void;
  readonly onPosterChange: (timeMs: number) => void;
  readonly onAddMute: (timeMs: number) => void;
  readonly onAddTrack: (kind: EditingProjectDto['tracks'][number]['kind']) => void;
  readonly onMoveTrack: (trackId: string, delta: -1 | 1) => void;
  readonly onMoveClip: (trackId: string, clipId: string, startMs: number) => void;
  readonly onRemoveTrack: (trackId: string) => void;
  readonly onTrackChange: (
    trackId: string,
    patch: Partial<EditingProjectDto['tracks'][number]>,
  ) => void;
  readonly onUpdateMute: (index: number, range: MuteRange) => void;
  readonly onRemoveMute: (index: number) => void;
  readonly onReset: () => void;
}

function TimelineEditor(props: TimelineEditorProps): ReactElement {
  const {
    durationMs,
    currentMs,
    hasAudio,
    tracks,
    projectSaveState,
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
    onAddTrack,
    onMoveTrack,
    onMoveClip,
    onRemoveTrack,
    onUpdateMute,
    onTrackChange,
    onRemoveMute,
    onReset,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<TimelineDrag | null>(null);
  const [context, setContext] = useState<TimelineContext | null>(null);
  const safeDurationMs = Math.max(durationMs, 1);
  const screenTimelineClip = tracks.find((track) => track.kind === 'screen')?.clips[0];
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
  const sourceTimeAtTimeline = (timelineMs: number): number =>
    screenTimelineClip === undefined
      ? timelineMs
      : Math.min(
          screenTimelineClip.sourceStartMs + screenTimelineClip.durationMs,
          Math.max(
            screenTimelineClip.sourceStartMs,
            screenTimelineClip.sourceStartMs + timelineMs - screenTimelineClip.timelineStartMs,
          ),
        );

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
      else if (drag.type === 'trim-start') {
        onTrimStartChange(drag.clipSourceStartMs + timeMs - drag.clipTimelineStartMs);
      } else if (drag.type === 'trim-end') {
        onTrimEndChange(drag.clipSourceStartMs + timeMs - drag.clipTimelineStartMs);
      } else if (drag.type === 'clip-move') {
        const bounds = canvasRef.current?.getBoundingClientRect();
        if (bounds === undefined) return;
        const timelineWidth = Math.max(1, bounds.width - timelineLabelWidthPx);
        const deltaMs = ((event.clientX - drag.startX) / timelineWidth) * safeDurationMs;
        onMoveClip(
          drag.trackId,
          drag.clipId,
          Math.min(
            safeDurationMs - drag.clipDurationMs,
            Math.max(0, drag.originalStartMs + deltaMs),
          ),
        );
      } else if (drag.type === 'mute-start' || drag.type === 'mute-end') {
        const range = mutedRanges[drag.index];
        if (range === undefined) return;
        if (drag.type === 'mute-start') {
          onUpdateMute(drag.index, {
            startMs: Math.min(range.endMs - minimumRangeMs, Math.max(0, timeMs)),
            endMs: range.endMs,
          });
        } else {
          onUpdateMute(drag.index, {
            startMs: range.startMs,
            endMs: Math.max(range.startMs + minimumRangeMs, Math.min(safeDurationMs, timeMs)),
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
    onMoveClip,
    mutedRanges,
    onSeek,
    onPosterChange,
    onTrimEndChange,
    onTrimStartChange,
    onUpdateMute,
    safeDurationMs,
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

  const clipLeft = percentage(screenTimelineClip?.timelineStartMs ?? 0);
  const clipWidth = Math.max(
    0.5,
    percentage(screenTimelineClip?.durationMs ?? trimEndMs - trimStartMs),
  );
  const posterTimelineMs =
    screenTimelineClip === undefined
      ? posterTimeMs
      : screenTimelineClip.timelineStartMs + posterTimeMs - screenTimelineClip.sourceStartMs;

  return (
    <section className="editor-timeline-panel" aria-label="Editing timeline">
      <div className="editor-timeline-toolbar">
        <div className="editor-timeline-title">
          <strong>Timeline</strong>
          <span>
            {projectSaveState === 'saving'
              ? 'Saving project…'
              : projectSaveState === 'error'
                ? 'Project could not be saved'
                : projectSaveState === 'loading'
                  ? 'Loading project…'
                  : 'Changes saved · drag clips to arrange; lane mix applies on export'}
          </span>
        </div>
        <div className="editor-timeline-tools">
          <label className="editor-add-track-control">
            <span className="visually-hidden">Add track</span>
            <select
              aria-label="Add track"
              disabled={projectSaveState === 'loading'}
              value=""
              onChange={(event) => {
                if (event.target.value !== '') {
                  onAddTrack(event.target.value as EditingProjectDto['tracks'][number]['kind']);
                }
              }}
            >
              <option value="">+ Track</option>
              <option value="screen">Screen</option>
              <option value="webcam">Webcam</option>
              <option value="microphone">Microphone</option>
              <option value="system-audio">System audio</option>
              <option value="music">Music</option>
              <option value="captions">Captions</option>
              <option value="overlays">Overlays</option>
            </select>
          </label>
          <button type="button" onClick={() => onTrimStartChange(sourceTimeAtTimeline(currentMs))}>
            Set In
          </button>
          <button type="button" onClick={() => onTrimEndChange(sourceTimeAtTimeline(currentMs))}>
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
          className={`editor-timeline-canvas ${drag?.type === 'clip-move' ? 'is-moving-clip' : drag !== null ? 'is-dragging' : ''}`}
          style={{ width: `${zoom * 100}%`, height: `${30 + tracks.length * 68}px` }}
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

          {tracks
            .slice()
            .sort((left, right) => left.order - right.order)
            .map((track, index, orderedTracks) => {
              const audioTrack =
                track.kind === 'microphone' ||
                track.kind === 'system-audio' ||
                track.kind === 'music';
              const videoTrack = track.kind === 'screen' || track.kind === 'webcam';
              const available = track.clips.length > 0;
              return (
                <TimelineTrack
                  key={track.id}
                  track={track}
                  icon={
                    track.kind === 'screen' || track.kind === 'webcam'
                      ? 'monitor'
                      : audioTrack
                        ? 'activity'
                        : 'sparkles'
                  }
                  first={index === 0}
                  last={index === orderedTracks.length - 1}
                  onChange={(patch) => onTrackChange(track.id, patch)}
                  onMoveUp={() => onMoveTrack(track.id, -1)}
                  onMoveDown={() => onMoveTrack(track.id, 1)}
                  onRemove={() => onRemoveTrack(track.id)}
                >
                  {track.kind === 'screen' && available ? (
                    <div
                      className={`editor-video-clip ${track.visible ? '' : 'is-track-disabled'}`}
                      style={{ left: `${clipLeft}%`, width: `${clipWidth}%` }}
                      onContextMenu={(event) => openContextMenu(event)}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        const clip = track.clips[0];
                        if (clip !== undefined && !track.locked) {
                          setDrag({
                            type: 'clip-move',
                            trackId: track.id,
                            clipId: clip.id,
                            startX: event.clientX,
                            originalStartMs: clip.timelineStartMs,
                            clipDurationMs: clip.durationMs,
                          });
                        }
                      }}
                    >
                      {!track.locked && (
                        <TimelineHandle
                          label="Adjust trim start"
                          side="start"
                          onStart={() => {
                            const clip = track.clips[0];
                            if (clip !== undefined) {
                              setDrag({
                                type: 'trim-start',
                                clipTimelineStartMs: clip.timelineStartMs,
                                clipSourceStartMs: clip.sourceStartMs,
                              });
                            }
                          }}
                        />
                      )}
                      <div className="editor-filmstrip" aria-hidden="true">
                        {Array.from({ length: 24 }, (_, thumbnailIndex) =>
                          thumbnailUrl === null ? (
                            <span key={thumbnailIndex} />
                          ) : (
                            <img key={thumbnailIndex} alt="" draggable={false} src={thumbnailUrl} />
                          ),
                        )}
                      </div>
                      <span className="editor-clip-name">Screen recording</span>
                      {!track.locked && (
                        <TimelineHandle
                          label="Adjust trim end"
                          side="end"
                          onStart={() => {
                            const clip = track.clips[0];
                            if (clip !== undefined) {
                              setDrag({
                                type: 'trim-end',
                                clipTimelineStartMs: clip.timelineStartMs,
                                clipSourceStartMs: clip.sourceStartMs,
                              });
                            }
                          }}
                        />
                      )}
                    </div>
                  ) : audioTrack && available ? (
                    <>
                      <div
                        className={`editor-audio-clip ${track.muted ? 'is-track-muted' : ''}`}
                        style={{
                          left: `${percentage(track.clips[0]?.timelineStartMs ?? 0)}%`,
                          width: `${percentage(track.clips[0]?.durationMs ?? 0)}%`,
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          const clip = track.clips[0];
                          if (clip !== undefined && !track.locked) {
                            setDrag({
                              type: 'clip-move',
                              trackId: track.id,
                              clipId: clip.id,
                              startX: event.clientX,
                              originalStartMs: clip.timelineStartMs,
                              clipDurationMs: clip.durationMs,
                            });
                          }
                        }}
                        onContextMenu={(event) => openContextMenu(event)}
                      >
                        <div className="editor-waveform" aria-hidden="true">
                          {waveform.map((height, waveformIndex) => (
                            <i key={waveformIndex} style={{ height: `${height}%` }} />
                          ))}
                        </div>
                        <span className="editor-clip-name">{track.name}</span>
                      </div>
                      {track.kind !== 'music' &&
                        mutedRanges.map((range, rangeIndex) => (
                          <div
                            key={`${range.startMs}-${range.endMs}-${rangeIndex}`}
                            className="editor-mute-block"
                            style={{
                              left: `${percentage(range.startMs)}%`,
                              width: `${Math.max(0.35, percentage(range.endMs) - percentage(range.startMs))}%`,
                            }}
                            onContextMenu={(event) => openContextMenu(event, rangeIndex)}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <TimelineHandle
                              range
                              label="Adjust mute start"
                              side="start"
                              onStart={() => setDrag({ type: 'mute-start', index: rangeIndex })}
                            />
                            <span>Muted</span>
                            <TimelineHandle
                              range
                              label="Adjust mute end"
                              side="end"
                              onStart={() => setDrag({ type: 'mute-end', index: rangeIndex })}
                            />
                          </div>
                        ))}
                    </>
                  ) : (
                    <span className="editor-empty-track">
                      {videoTrack
                        ? 'No camera clip in this project yet'
                        : audioTrack
                          ? 'No audio clip in this project yet'
                          : 'Ready for titles and visual elements'}
                    </span>
                  )}
                </TimelineTrack>
              );
            })}

          <button
            aria-label={`Thumbnail at ${formatEditorTime(posterTimelineMs)}`}
            className="editor-poster-pin"
            style={{ left: timelinePosition(posterTimelineMs) }}
            title="Library thumbnail"
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
              onSeek(posterTimelineMs);
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
                onSelect={() =>
                  runContext(() => onTrimStartChange(sourceTimeAtTimeline(context.timeMs)))
                }
              />
              <ContextAction
                label="Set trim end here"
                onSelect={() =>
                  runContext(() => onTrimEndChange(sourceTimeAtTimeline(context.timeMs)))
                }
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
              trimEndMs={durationMs}
              trimStartMs={0}
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
  track,
  icon,
  first,
  last,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: {
  readonly track: EditingProjectDto['tracks'][number];
  readonly icon: 'monitor' | 'activity' | 'sparkles';
  readonly first: boolean;
  readonly last: boolean;
  readonly onChange: (patch: Partial<EditingProjectDto['tracks'][number]>) => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onRemove: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={`editor-timeline-track-row ${track.locked ? 'is-locked' : ''}`}>
      <div className="editor-track-label" onPointerDown={(event) => event.stopPropagation()}>
        <div className="editor-track-heading">
          <Icon name={icon} size={14} />
          <span title={track.name}>{track.name}</span>
          <button
            aria-label={`Move ${track.name} up`}
            disabled={first}
            type="button"
            onClick={onMoveUp}
          >
            ↑
          </button>
          <button
            aria-label={`Move ${track.name} down`}
            disabled={last}
            type="button"
            onClick={onMoveDown}
          >
            ↓
          </button>
        </div>
        <div className="editor-track-controls">
          {(track.kind === 'screen' ||
            track.kind === 'webcam' ||
            track.kind === 'captions' ||
            track.kind === 'overlays') && (
            <button
              aria-label={`${track.visible ? 'Hide' : 'Show'} ${track.name}`}
              aria-pressed={track.visible}
              title={track.visible ? 'Hide track' : 'Show track'}
              type="button"
              onClick={() => onChange({ visible: !track.visible })}
            >
              {track.visible ? '◉' : '○'}
            </button>
          )}
          {(track.kind === 'microphone' ||
            track.kind === 'system-audio' ||
            track.kind === 'music') && (
            <>
              <button
                aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
                aria-pressed={!track.muted}
                title={track.muted ? 'Unmute track' : 'Mute track'}
                type="button"
                onClick={() => onChange({ muted: !track.muted })}
              >
                {track.muted ? '×' : '♪'}
              </button>
              <input
                aria-label={`${track.name} volume`}
                disabled={track.muted || track.locked}
                max={2}
                min={0}
                step={0.05}
                title={`${Math.round(track.gain * 100)}% volume`}
                type="range"
                value={track.gain}
                onChange={(event) => onChange({ gain: Number(event.target.value) })}
              />
            </>
          )}
          <button
            aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`}
            aria-pressed={track.locked}
            title={track.locked ? 'Unlock track' : 'Lock track'}
            type="button"
            onClick={() => onChange({ locked: !track.locked })}
          >
            {track.locked ? '▣' : '□'}
          </button>
          {track.clips.length === 0 && track.kind !== 'screen' && (
            <button
              aria-label={`Remove ${track.name} track`}
              title="Remove empty track"
              type="button"
              onClick={onRemove}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className={`editor-track-lane editor-track-${track.kind}`}>
        {track.locked && <span className="editor-track-lock-badge">Locked</span>}
        {children}
      </div>
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
