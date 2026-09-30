import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  AppPreferencesDto,
  CapturePermissionsDto,
  CaptureSourceDto,
  RecordingMetadataDto,
} from '@screen-recorder/contracts';

import {
  Button,
  Dialog,
  EmptyState,
  Icon,
  LoadingState,
  Menu,
  MenuItem,
  StatusBadge,
  Toggle,
} from './components';
import { useRendererSelector, type RendererStore } from './renderer-store';

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    timestamp,
  );
}

function sourceIcon(source: CaptureSourceDto): 'monitor' | 'window' | 'grid' {
  if (source.kind === 'display') return 'monitor';
  if (source.kind === 'window' || source.kind === 'application') return 'window';
  return 'grid';
}

function sourceDimensions(source: CaptureSourceDto): string {
  return source.dimensions === null
    ? 'Native dimensions'
    : `${source.dimensions.width.toLocaleString()} × ${source.dimensions.height.toLocaleString()}`;
}

function qualityLabel(
  preferences: Pick<
    AppPreferencesDto,
    'defaultProfileId' | 'defaultResolution' | 'defaultFrameRate'
  > | null,
): string {
  if (preferences === null) return 'Balanced · Source · 60 FPS';
  const profile =
    preferences.defaultProfileId[0].toUpperCase() + preferences.defaultProfileId.slice(1);
  const resolution =
    preferences.defaultResolution === '4k'
      ? '4K'
      : preferences.defaultResolution === 'source'
        ? 'Source'
        : '1080p';
  return `${profile} · ${resolution} · ${preferences.defaultFrameRate} FPS`;
}

function permissionLabel(state: CapturePermissionsDto['screenRecording']): string {
  if (state === 'not-determined') return 'Not requested';
  return state[0].toUpperCase() + state.slice(1);
}

export function OnboardingView({ store }: { readonly store: RendererStore }) {
  const permissions = useRendererSelector(store, (state) => state.permissions);
  const operation = useRendererSelector(store, (state) => state.operation);
  const screenGranted = permissions?.screenRecording === 'granted';
  const restartRequired = permissions?.screenRecordingRequiresRestart === true;
  const ready = screenGranted && !restartRequired;

  return (
    <div className="onboarding-layout">
      <section className="onboarding-card">
        <div className="onboarding-mark">
          <Icon name="sparkles" size={25} />
        </div>
        <div className="section-eyebrow">
          <span className="eyebrow-line" /> First-time setup
        </div>
        <h2>Beautiful captures start with two clear choices.</h2>
        <p className="onboarding-lead">
          Capture records and encodes locally on this Mac. Screen Recording is required; microphone
          access is optional and only used when you enable it.
        </p>

        <div className="permission-setup-list">
          <div className="permission-setup-row">
            <span className="permission-setup-icon">
              <Icon name="monitor" />
            </span>
            <div>
              <strong>Screen Recording</strong>
              <p>Allows macOS to provide the display or window you choose.</p>
            </div>
            <StatusBadge tone={ready ? 'success' : restartRequired ? 'warning' : 'neutral'}>
              {restartRequired
                ? 'Restart required'
                : permissionLabel(permissions?.screenRecording ?? 'not-determined')}
            </StatusBadge>
            <div className="permission-setup-actions">
              {restartRequired ? (
                <Button
                  icon="activity"
                  variant="primary"
                  onClick={() => void store.relaunchApplication()}
                >
                  Restart Capture
                </Button>
              ) : permissions?.screenRecording === 'denied' ||
                permissions?.screenRecording === 'restricted' ? (
                <Button
                  icon="settings"
                  variant="secondary"
                  onClick={() => void store.openPermissionSettings('screen-recording')}
                >
                  Open System Settings
                </Button>
              ) : screenGranted ? null : (
                <Button
                  disabled={operation !== 'idle'}
                  icon="activity"
                  variant="primary"
                  onClick={() => void store.requestPermissions(false)}
                >
                  Allow Screen Recording
                </Button>
              )}
            </div>
          </div>

          <div className="permission-setup-row">
            <span className="permission-setup-icon">
              <Icon name="mic" />
            </span>
            <div>
              <strong>Microphone</strong>
              <p>Optional. Capture never enables your microphone without your selection.</p>
            </div>
            <StatusBadge tone={permissions?.microphone === 'granted' ? 'success' : 'neutral'}>
              {permissionLabel(permissions?.microphone ?? 'not-determined')}
            </StatusBadge>
            <div className="permission-setup-actions">
              {permissions?.microphone === 'denied' || permissions?.microphone === 'restricted' ? (
                <Button
                  icon="settings"
                  variant="secondary"
                  onClick={() => void store.openPermissionSettings('microphone')}
                >
                  Open System Settings
                </Button>
              ) : permissions?.microphone === 'granted' ? null : (
                <Button
                  disabled={operation !== 'idle'}
                  icon="mic"
                  variant="secondary"
                  onClick={() => void store.requestPermissions(true)}
                >
                  Allow microphone
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="onboarding-actions">
          <Button variant="ghost" onClick={() => void store.completeOnboarding()}>
            Set up later
          </Button>
          <Button
            disabled={!ready || operation !== 'idle'}
            icon="chevron-right"
            variant="primary"
            onClick={() => void store.completeOnboarding()}
          >
            Continue to recorder
          </Button>
        </div>
      </section>
    </div>
  );
}

function PermissionRecoveryPanel({ store }: { readonly store: RendererStore }) {
  const permissions = useRendererSelector(store, (state) => state.permissions);
  const microphoneRequested = useRendererSelector(
    store,
    (state) => state.recordingOptions.microphone,
  );
  const operation = useRendererSelector(store, (state) => state.operation);
  if (permissions === null) return null;

  const restartRequired = permissions.screenRecordingRequiresRestart;
  const screenMissing = permissions.screenRecording !== 'granted';
  const microphoneMissing = microphoneRequested && permissions.microphone !== 'granted';
  if (!restartRequired && !screenMissing && !microphoneMissing) return null;

  const microphoneIssue = !restartRequired && !screenMissing && microphoneMissing;
  const denied = microphoneIssue
    ? permissions.microphone === 'denied' || permissions.microphone === 'restricted'
    : permissions.screenRecording === 'denied' || permissions.screenRecording === 'restricted';

  return (
    <section className="permission-recovery-card">
      <span className="permission-setup-icon">
        <Icon name={microphoneIssue ? 'mic' : 'monitor'} />
      </span>
      <div>
        <strong>
          {restartRequired
            ? 'Restart required to activate Screen Recording'
            : microphoneIssue
              ? 'Microphone access needs attention'
              : 'Screen Recording access is required'}
        </strong>
        <p>
          {restartRequired
            ? 'macOS granted access, but the capture process must restart before it can use it.'
            : denied
              ? 'Open System Settings, enable access for Capture, then return here.'
              : 'macOS will show a system prompt. Capture only requests the access shown here.'}
        </p>
      </div>
      {restartRequired ? (
        <Button icon="activity" variant="primary" onClick={() => void store.relaunchApplication()}>
          Restart
        </Button>
      ) : denied ? (
        <Button
          icon="settings"
          variant="secondary"
          onClick={() =>
            void store.openPermissionSettings(microphoneIssue ? 'microphone' : 'screen-recording')
          }
        >
          Open Settings
        </Button>
      ) : (
        <Button
          disabled={operation !== 'idle'}
          icon="activity"
          variant="primary"
          onClick={() => void store.requestPermissions(microphoneIssue)}
        >
          Allow access
        </Button>
      )}
    </section>
  );
}

export function RecorderView({ store }: { readonly store: RendererStore }) {
  const initialized = useRendererSelector(store, (state) => state.initialized);
  const sources = useRendererSelector(store, (state) => state.sources);
  const selectedSourceId = useRendererSelector(store, (state) => state.selectedSourceId);
  const permissions = useRendererSelector(store, (state) => state.permissions);
  const preferences = useRendererSelector(store, (state) => state.preferences);
  const activeSession = useRendererSelector(store, (state) => state.activeSession);
  const recordingState = useRendererSelector(store, (state) => state.recordingState);
  const progress = useRendererSelector(store, (state) => state.progress);
  const recordingOptions = useRendererSelector(store, (state) => state.recordingOptions);
  const diskSpace = useRendererSelector(store, (state) => state.diskSpace);
  const operation = useRendererSelector(store, (state) => state.operation);

  const recording = ['preparing', 'capturing', 'paused', 'stopping'].includes(recordingState);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const timerRef = useRef<{
    readonly sessionId: string | null;
    readonly pausedAt: number | null;
    readonly pausedDurationMs: number;
  }>({ sessionId: null, pausedAt: null, pausedDurationMs: 0 });

  useEffect(() => {
    if (!initialized || !recording || activeSession === null || activeSession.startedAt === null) {
      timerRef.current = { sessionId: null, pausedAt: null, pausedDurationMs: 0 };
      return;
    }

    if (timerRef.current.sessionId !== activeSession.id) {
      timerRef.current = {
        sessionId: activeSession.id,
        pausedAt: recordingState === 'paused' ? Date.now() : null,
        pausedDurationMs: activeSession.pausedDurationMs,
      };
    } else if (recordingState === 'paused' && timerRef.current.pausedAt === null) {
      timerRef.current = { ...timerRef.current, pausedAt: Date.now() };
    } else if (recordingState !== 'paused' && timerRef.current.pausedAt !== null) {
      timerRef.current = {
        ...timerRef.current,
        pausedAt: null,
        pausedDurationMs:
          timerRef.current.pausedDurationMs + Date.now() - timerRef.current.pausedAt,
      };
    }

    const interval = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [activeSession, initialized, recording, recordingState]);

  if (!initialized) return <LoadingState label="Preparing your workspace" />;

  const permissionGranted =
    permissions?.screenRecording === 'granted' &&
    permissions.screenRecordingRequiresRestart === false;
  const selectedSource = sources.find((source) => source.id === selectedSourceId);
  const microphoneReady = !recordingOptions.microphone || permissions?.microphone === 'granted';
  const canStart =
    selectedSource !== undefined && permissionGranted && microphoneReady && operation === 'idle';
  const wallClockDuration =
    activeSession?.startedAt === null || activeSession?.startedAt === undefined
      ? 0
      : Math.max(
          0,
          clockNow -
            activeSession.startedAt -
            timerRef.current.pausedDurationMs -
            (timerRef.current.pausedAt === null ? 0 : clockNow - timerRef.current.pausedAt),
        );
  const displayedDuration = Math.max(progress.durationMs, wallClockDuration);

  return (
    <div className="view-stack">
      <section
        className={`recorder-hero ${recording ? 'is-recording' : ''}`}
        aria-labelledby="recorder-title"
      >
        <div className="recorder-hero-copy">
          <div className="section-eyebrow">
            <span className="eyebrow-line" /> Native capture
          </div>
          <h2 id="recorder-title">Make every frame count.</h2>
          <p>
            Capture a crisp, fluid recording of your screen with hardware-accelerated encoding built
            for macOS.
          </p>
        </div>
        <div className="recording-orb" aria-hidden="true">
          <div className="orb-core">
            <Icon name={recording ? 'circle' : 'sparkles'} size={28} />
          </div>
          <span className="orb-ring orb-ring-one" />
          <span className="orb-ring orb-ring-two" />
        </div>
      </section>

      {!recording && <PermissionRecoveryPanel store={store} />}

      {recording && activeSession !== null ? (
        <section className="active-recording-card" aria-live="polite">
          <div className="active-recording-main">
            <div className="recording-indicator">
              <span /> Live recording
            </div>
            <div className="recording-timer">{formatDuration(displayedDuration)}</div>
            <p>
              {selectedSource?.name ?? 'Selected source'} · {formatBytes(progress.encodedBytes)}{' '}
              encoded
            </p>
            <div className="active-recording-details">
              <span>
                {recordingOptions.profileId} · {recordingOptions.frameRate} FPS
              </span>
              {progress.droppedFrames > 0 && (
                <span className="recording-warning">{progress.droppedFrames} dropped frames</span>
              )}
              {diskSpace !== null && <span className="recording-warning">Low disk space</span>}
            </div>
          </div>
          <div className="recording-actions">
            {recordingState === 'paused' ? (
              <Button
                disabled={operation !== 'idle'}
                icon="play"
                variant="secondary"
                onClick={() => void store.resumeRecording()}
              >
                Resume
              </Button>
            ) : (
              <Button
                disabled={operation !== 'idle'}
                icon="pause"
                variant="secondary"
                onClick={() => void store.pauseRecording()}
              >
                Pause
              </Button>
            )}
            <Button
              disabled={operation !== 'idle'}
              icon="stop"
              variant="danger"
              onClick={() => void store.stopRecording()}
            >
              Stop
            </Button>
          </div>
        </section>
      ) : (
        <section className="control-grid">
          <div className="surface-card source-card">
            <div className="card-heading">
              <div>
                <div className="card-kicker">Capture source</div>
                <h3>What would you like to record?</h3>
              </div>
              <StatusBadge tone={sources.length > 0 ? 'success' : 'warning'}>
                {sources.length} available
              </StatusBadge>
            </div>
            {sources.length === 0 ? (
              <EmptyState
                icon="monitor"
                title="No sources available"
                description="macOS did not return a display or window source yet."
                action={
                  <Button
                    icon="activity"
                    variant="secondary"
                    onClick={() => void store.refreshSources()}
                  >
                    Refresh sources
                  </Button>
                }
              />
            ) : (
              <div className="source-list" role="listbox" aria-label="Capture source">
                {sources.map((source) => (
                  <button
                    aria-selected={selectedSourceId === source.id}
                    className={`source-option ${selectedSourceId === source.id ? 'is-selected' : ''}`}
                    disabled={!source.isAvailable}
                    key={source.id}
                    role="option"
                    type="button"
                    onClick={() => store.selectSource(source.id)}
                  >
                    <span className="source-icon">
                      <Icon name={sourceIcon(source)} />
                    </span>
                    <span className="source-details">
                      <strong>{source.name}</strong>
                      <small>
                        {source.kind} · {sourceDimensions(source)}
                      </small>
                    </span>
                    <span className="source-check" aria-hidden="true">
                      <Icon name="circle" size={14} />
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="source-actions">
              <Button
                disabled={selectedSource?.kind !== 'display' || operation !== 'idle'}
                icon="grid"
                variant="secondary"
                onClick={() => void store.selectRegion()}
              >
                {recordingOptions.region === null ? 'Select region' : 'Change region'}
              </Button>
              {recordingOptions.region !== null && (
                <Button icon="circle" variant="ghost" onClick={() => store.clearRegion()}>
                  Clear region
                </Button>
              )}
            </div>
          </div>

          <div className="right-column">
            <div className="surface-card quality-card">
              <div className="card-kicker">Recording profile</div>
              <div className="quality-value">
                <span className="quality-icon">
                  <Icon name="sliders" />
                </span>
                <strong>
                  {qualityLabel({
                    ...preferences,
                    defaultProfileId: recordingOptions.profileId,
                    defaultResolution: recordingOptions.resolution,
                    defaultFrameRate: recordingOptions.frameRate,
                  })}
                </strong>
              </div>
              <label className="compact-field">
                <span>Profile</span>
                <select
                  value={recordingOptions.profileId}
                  onChange={(event) =>
                    store.setRecordingOptions({
                      profileId: event.target.value as typeof recordingOptions.profileId,
                    })
                  }
                >
                  <option value="compatible">Compatible · H.264</option>
                  <option value="balanced">Balanced · HEVC</option>
                  <option value="master">Master · ProRes</option>
                </select>
              </label>
              <div className="compact-field-grid">
                <label className="compact-field">
                  <span>Resolution</span>
                  <select
                    value={recordingOptions.resolution}
                    onChange={(event) =>
                      store.setRecordingOptions({
                        resolution: event.target.value as typeof recordingOptions.resolution,
                      })
                    }
                  >
                    <option value="source">Source</option>
                    <option value="1080p">1080p</option>
                    <option value="4k">4K UHD</option>
                  </select>
                </label>
                <label className="compact-field">
                  <span>Frame rate</span>
                  <select
                    value={recordingOptions.frameRate}
                    onChange={(event) =>
                      store.setRecordingOptions({
                        frameRate: Number(event.target.value) as typeof recordingOptions.frameRate,
                      })
                    }
                  >
                    <option value="30">30 FPS</option>
                    <option value="60">60 FPS</option>
                  </select>
                </label>
              </div>
              <p>These values apply to the next recording.</p>
            </div>
            <div className="surface-card audio-card">
              <div className="card-kicker">Audio</div>
              <Toggle
                checked={recordingOptions.systemAudio}
                disabled={operation !== 'idle'}
                label="System audio"
                onChange={(checked) => store.setRecordingOptions({ systemAudio: checked })}
              />
              <Toggle
                checked={recordingOptions.microphone}
                disabled={operation !== 'idle'}
                label="Microphone"
                onChange={(checked) => store.setRecordingOptions({ microphone: checked })}
              />
              <div className="audio-divider" />
              <Toggle
                checked={recordingOptions.showsCursor}
                label="Show cursor"
                onChange={(checked) => store.setRecordingOptions({ showsCursor: checked })}
              />
              <Toggle
                checked={recordingOptions.showsMouseClicks}
                label="Show click indicators"
                onChange={(checked) => store.setRecordingOptions({ showsMouseClicks: checked })}
              />
            </div>
          </div>
        </section>
      )}

      {!recording && (
        <section className="start-bar">
          <div className="permission-summary">
            <span className={`permission-dot ${permissionGranted ? 'is-granted' : ''}`} />
            <div>
              <strong>
                {permissionGranted ? 'Ready to record' : 'Screen permission required'}
              </strong>
              <span>
                {diskSpace !== null
                  ? `Low disk space · ${formatBytes(diskSpace.availableBytes)} available`
                  : permissionGranted
                    ? recordingOptions.region === null
                      ? 'Your capture pipeline is ready.'
                      : 'Region capture is ready.'
                    : 'Allow Screen Recording access to continue.'}
              </span>
            </div>
          </div>
          {permissions?.screenRecordingRequiresRestart === true ? (
            <Button
              icon="activity"
              variant="primary"
              onClick={() => void store.relaunchApplication()}
            >
              Restart Capture
            </Button>
          ) : permissionGranted ? (
            <Button
              disabled={!canStart}
              icon="circle"
              variant="primary"
              onClick={() => void store.startRecording()}
            >
              Start recording
            </Button>
          ) : (
            <Button
              disabled={operation !== 'idle'}
              icon="activity"
              variant="primary"
              onClick={() => void store.requestPermissions()}
            >
              Allow access
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

export function LibraryView({ store }: { readonly store: RendererStore }) {
  const initialized = useRendererSelector(store, (state) => state.initialized);
  const recordings = useRendererSelector(store, (state) => state.recordings);
  const operation = useRendererSelector(store, (state) => state.operation);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name' | 'duration' | 'size'>('newest');
  const [renameTarget, setRenameTarget] = useState<RecordingMetadataDto | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<RecordingMetadataDto | null>(null);
  const [renderedCount, setRenderedCount] = useState(80);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const visibleRecordings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = recordings.filter((recording) => {
      if (normalizedQuery.length === 0) return true;
      return [recording.title, recording.codec, recording.profileId]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });

    return [...filtered].sort((left, right) => {
      if (sort === 'oldest') return left.createdAt - right.createdAt;
      if (sort === 'name') return left.title.localeCompare(right.title);
      if (sort === 'duration') return right.durationMs - left.durationMs;
      if (sort === 'size') return right.fileSizeBytes - left.fileSizeBytes;
      return right.createdAt - left.createdAt;
    });
  }, [query, recordings, sort]);

  useEffect(() => setRenderedCount(80), [query, recordings, sort]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (target === null || renderedCount >= visibleRecordings.length) return;

    // Bound mounted cards so thumbnail decoding and layout stay smooth for very large libraries.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) {
          setRenderedCount((count) => Math.min(count + 80, visibleRecordings.length));
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [renderedCount, visibleRecordings.length]);

  if (!initialized) return <LoadingState label="Loading library" />;
  if (recordings.length === 0) {
    return (
      <EmptyState
        icon="archive"
        title="Your recordings will live here"
        description="Once you finish a capture, it will appear in this library with its quality and audio details."
        action={
          <Button
            icon="monitor"
            variant="primary"
            onClick={() => store.setActiveScreen('recorder')}
          >
            Create your first recording
          </Button>
        }
      />
    );
  }

  return (
    <div className="view-stack">
      <div className="library-summary">
        <div>
          <div className="section-eyebrow">
            <span className="eyebrow-line" /> Recent captures
          </div>
          <h2>
            {recordings.length} recording{recordings.length === 1 ? '' : 's'}
          </h2>
        </div>
        <div className="library-header-actions">
          <Button icon="activity" variant="ghost" onClick={() => void store.refreshRecordings()}>
            Refresh
          </Button>
          <Button
            icon="folder"
            variant="secondary"
            onClick={() => void store.openRecordingsFolder()}
          >
            Open recordings folder
          </Button>
        </div>
      </div>
      <div className="library-toolbar">
        <label className="library-search">
          <Icon name="search" size={16} />
          <span className="visually-hidden">Search recordings</span>
          <input
            placeholder="Search recordings"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="library-sort">
          <span>Sort</span>
          <select
            aria-label="Sort recordings"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name</option>
            <option value="duration">Duration</option>
            <option value="size">File size</option>
          </select>
        </label>
        <div className="library-layout-toggle" aria-label="Library layout" role="group">
          <Button
            aria-label="Grid view"
            aria-pressed={layout === 'grid'}
            icon="grid"
            variant="icon"
            onClick={() => setLayout('grid')}
          />
          <Button
            aria-label="List view"
            aria-pressed={layout === 'list'}
            icon="list"
            variant="icon"
            onClick={() => setLayout('list')}
          />
        </div>
      </div>
      {visibleRecordings.length === 0 ? (
        <EmptyState
          icon="search"
          title="No matching recordings"
          description="Try a different name, codec, or quality profile."
        />
      ) : (
        <section
          className={`library-grid ${layout === 'list' ? 'is-list' : ''}`}
          aria-label="Recordings"
        >
          {visibleRecordings.slice(0, renderedCount).map((recording) => (
            <RecordingCard
              key={recording.id}
              layout={layout}
              recording={recording}
              store={store}
              onDelete={() => setDeleteTarget(recording)}
              onRename={() => {
                setRenameTarget(recording);
                setRenameTitle(recording.title);
              }}
            />
          ))}
          {renderedCount < visibleRecordings.length && (
            <div
              ref={loadMoreRef}
              aria-label={`Loading more recordings; ${renderedCount} of ${visibleRecordings.length} shown`}
              className="library-load-more"
              role="status"
            />
          )}
        </section>
      )}

      <Dialog
        description="The media file and library title will be updated together."
        open={renameTarget !== null}
        title="Rename recording"
        onClose={() => setRenameTarget(null)}
      >
        <form
          className="library-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (renameTarget === null) return;
            void store.renameRecording(renameTarget.id, renameTitle).then((renamed) => {
              if (renamed) setRenameTarget(null);
            });
          }}
        >
          <label className="field">
            <span>Name</span>
            <input
              autoFocus
              maxLength={180}
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <Button type="button" variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={operation !== 'idle' || renameTitle.trim().length === 0}
              icon="edit"
              type="submit"
              variant="primary"
            >
              Rename
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description={
          deleteTarget?.availability === 'missing'
            ? 'The missing item will be removed from the library.'
            : 'The media file will be moved to Trash, where it can still be recovered.'
        }
        open={deleteTarget !== null}
        title={deleteTarget?.availability === 'missing' ? 'Remove recording?' : 'Move to Trash?'}
        onClose={() => setDeleteTarget(null)}
      >
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            disabled={operation !== 'idle'}
            icon="trash"
            variant="danger"
            onClick={() => {
              if (deleteTarget === null) return;
              void store.deleteRecording(deleteTarget.id).then((deleted) => {
                if (deleted) setDeleteTarget(null);
              });
            }}
          >
            {deleteTarget?.availability === 'missing' ? 'Remove' : 'Move to Trash'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function RecordingCard({
  recording,
  layout,
  store,
  onRename,
  onDelete,
}: {
  readonly recording: RecordingMetadataDto;
  readonly layout: 'grid' | 'list';
  readonly store: RendererStore;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  const missing = recording.availability === 'missing';

  return (
    <article className={`recording-card ${missing ? 'is-missing' : ''}`}>
      <div className="recording-thumbnail">
        <RecordingThumbnail recording={recording} store={store} />
        <button
          aria-label={`Open ${recording.title}`}
          className="thumbnail-play"
          disabled={missing}
          type="button"
          onClick={() => void store.openRecording(recording.id)}
        >
          <Icon name={missing ? 'archive' : 'play'} size={layout === 'list' ? 18 : 25} />
        </button>
        <span>{missing ? 'Missing file' : recording.profileId}</span>
      </div>
      <div className="recording-card-body">
        <div className="recording-card-title">
          <h3>{recording.title || 'Untitled recording'}</h3>
          <Menu label="Actions">
            <MenuItem disabled={missing} onSelect={() => void store.openRecording(recording.id)}>
              Open
            </MenuItem>
            <MenuItem disabled={missing} onSelect={onRename}>
              Rename
            </MenuItem>
            <MenuItem disabled={missing} onSelect={() => void store.revealRecording(recording.id)}>
              Reveal in Finder
            </MenuItem>
            <MenuItem onSelect={onDelete}>
              {missing ? 'Remove from library' : 'Move to Trash'}
            </MenuItem>
          </Menu>
        </div>
        <p>{formatDate(recording.createdAt)}</p>
        <div className="recording-meta">
          <span>
            {recording.width} × {recording.height}
          </span>
          <span>{formatDuration(recording.durationMs)}</span>
          <span>{formatBytes(recording.fileSizeBytes)}</span>
          <span>
            {recording.codec === 'prores422' ? 'ProRes 422' : recording.codec.toUpperCase()}
          </span>
        </div>
      </div>
    </article>
  );
}

function RecordingThumbnail({
  recording,
  store,
}: {
  readonly recording: RecordingMetadataDto;
  readonly store: RendererStore;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (recording.availability === 'missing') return undefined;
    let cancelled = false;
    const load = () => {
      void store
        .getRecordingThumbnail(recording.id)
        .then((thumbnail) => {
          if (!cancelled) setDataUrl(thumbnail);
        })
        .catch(() => undefined);
    };

    if (typeof IntersectionObserver === 'undefined' || host.current === null) {
      load();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: '180px' },
    );
    observer.observe(host.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [recording.availability, recording.id, store]);

  return (
    <div className="recording-thumbnail-image" ref={host}>
      {dataUrl !== null && <img alt="" draggable={false} src={dataUrl} />}
    </div>
  );
}

const themeOptions = [
  { value: 'system', label: 'System', icon: 'system' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'circle' },
] as const;

export function SettingsView({ store }: { readonly store: RendererStore }) {
  const preferences = useRendererSelector(store, (state) => state.preferences);
  const permissions = useRendererSelector(store, (state) => state.permissions);
  const operation = useRendererSelector(store, (state) => state.operation);
  const [outputDirectory, setOutputDirectory] = useState(preferences?.outputDirectory ?? '');
  const [startStopShortcut, setStartStopShortcut] = useState(
    preferences?.shortcuts.startStop ?? '',
  );
  const [pauseResumeShortcut, setPauseResumeShortcut] = useState(
    preferences?.shortcuts.pauseResume ?? '',
  );

  if (preferences === null) return <LoadingState label="Loading settings" />;

  const saveOutputDirectory = () => {
    if (outputDirectory.trim().length > 0 && outputDirectory !== preferences.outputDirectory) {
      void store.updatePreferences({ outputDirectory: outputDirectory.trim() });
    }
  };

  return (
    <div className="settings-layout">
      <div className="settings-intro">
        <div className="section-eyebrow">
          <span className="eyebrow-line" /> Preferences
        </div>
        <h2>Make Capture feel like yours.</h2>
        <p>Quality defaults and accessibility choices are saved locally on this Mac.</p>
      </div>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h3>Privacy permissions</h3>
            <p>Review access or recover quickly after a permission is changed.</p>
          </div>
          <Button icon="activity" variant="ghost" onClick={() => void store.refreshPermissions()}>
            Check again
          </Button>
        </div>
        <div className="settings-permissions">
          <div className="settings-permission-row">
            <span className="permission-setup-icon">
              <Icon name="monitor" />
            </span>
            <div>
              <strong>Screen Recording</strong>
              <p>Required for display, window, application, and region capture.</p>
            </div>
            <StatusBadge
              tone={
                permissions?.screenRecordingRequiresRestart === true
                  ? 'warning'
                  : permissions?.screenRecording === 'granted'
                    ? 'success'
                    : 'danger'
              }
            >
              {permissions?.screenRecordingRequiresRestart === true
                ? 'Restart required'
                : permissionLabel(permissions?.screenRecording ?? 'not-determined')}
            </StatusBadge>
            {permissions?.screenRecordingRequiresRestart === true ? (
              <Button variant="secondary" onClick={() => void store.relaunchApplication()}>
                Restart
              </Button>
            ) : permissions?.screenRecording === 'granted' ? null : (
              <Button
                variant="secondary"
                onClick={() =>
                  permissions?.screenRecording === 'not-determined'
                    ? void store.requestPermissions(false)
                    : void store.openPermissionSettings('screen-recording')
                }
              >
                {permissions?.screenRecording === 'not-determined' ? 'Request' : 'Open Settings'}
              </Button>
            )}
          </div>
          <div className="settings-permission-row">
            <span className="permission-setup-icon">
              <Icon name="mic" />
            </span>
            <div>
              <strong>Microphone</strong>
              <p>Optional and only active when microphone capture is selected.</p>
            </div>
            <StatusBadge tone={permissions?.microphone === 'granted' ? 'success' : 'neutral'}>
              {permissionLabel(permissions?.microphone ?? 'not-determined')}
            </StatusBadge>
            {permissions?.microphone === 'granted' ? null : (
              <Button
                variant="secondary"
                onClick={() =>
                  permissions?.microphone === 'not-determined'
                    ? void store.requestPermissions(true)
                    : void store.openPermissionSettings('microphone')
                }
              >
                {permissions?.microphone === 'not-determined' ? 'Request' : 'Open Settings'}
              </Button>
            )}
          </div>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h3>Appearance</h3>
            <p>Choose how the recorder looks in different lighting.</p>
          </div>
        </div>
        <div className="theme-options">
          {themeOptions.map((option) => (
            <button
              aria-pressed={preferences.theme === option.value}
              className={`theme-option ${preferences.theme === option.value ? 'is-selected' : ''}`}
              key={option.value}
              type="button"
              onClick={() => void store.updatePreferences({ theme: option.value })}
            >
              <Icon name={option.icon} size={18} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h3>Recording defaults</h3>
            <p>These values are used when a new capture starts.</p>
          </div>
          <StatusBadge tone="success">Up to 4K · 60 FPS</StatusBadge>
        </div>
        <div className="settings-fields">
          <label className="field">
            <span>Profile</span>
            <select
              disabled={operation !== 'idle'}
              value={preferences.defaultProfileId}
              onChange={(event) =>
                void store.updatePreferences({
                  defaultProfileId: event.target.value as AppPreferencesDto['defaultProfileId'],
                })
              }
            >
              <option value="compatible">Compatible · H.264</option>
              <option value="balanced">Balanced · HEVC</option>
              <option value="master">Master · ProRes</option>
            </select>
          </label>
          <label className="field">
            <span>Resolution</span>
            <select
              disabled={operation !== 'idle'}
              value={preferences.defaultResolution}
              onChange={(event) =>
                void store.updatePreferences({
                  defaultResolution: event.target.value as AppPreferencesDto['defaultResolution'],
                })
              }
            >
              <option value="source">Native source</option>
              <option value="1080p">1080p</option>
              <option value="4k">4K UHD</option>
            </select>
          </label>
          <label className="field">
            <span>Frame rate</span>
            <select
              disabled={operation !== 'idle'}
              value={preferences.defaultFrameRate}
              onChange={(event) =>
                void store.updatePreferences({
                  defaultFrameRate: Number(
                    event.target.value,
                  ) as AppPreferencesDto['defaultFrameRate'],
                })
              }
            >
              <option value="30">30 FPS</option>
              <option value="60">60 FPS</option>
            </select>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h3>Audio capture</h3>
            <p>Enable only the inputs you need for each recording.</p>
          </div>
        </div>
        <div className="settings-toggles">
          <Toggle
            checked={preferences.systemAudioEnabled}
            disabled={operation !== 'idle'}
            label="System audio"
            onChange={(checked) => void store.updatePreferences({ systemAudioEnabled: checked })}
          />
          <Toggle
            checked={preferences.microphoneEnabled}
            disabled={operation !== 'idle'}
            label="Microphone"
            onChange={(checked) => void store.updatePreferences({ microphoneEnabled: checked })}
          />
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h3>Storage</h3>
            <p>Completed recordings are written here. Use an absolute path.</p>
          </div>
        </div>
        <label className="field field-wide">
          <span>Output directory</span>
          <div className="input-with-icon">
            <Icon name="folder" size={16} />
            <input
              value={outputDirectory}
              placeholder="Default Movies / Screen Recorder"
              onBlur={saveOutputDirectory}
              onChange={(event) => setOutputDirectory(event.target.value)}
            />
          </div>
        </label>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h3>Shortcuts</h3>
            <p>
              Control recording even when Capture is not focused. Use Electron accelerator syntax.
            </p>
          </div>
        </div>
        <div className="settings-fields settings-fields-two">
          <label className="field">
            <span>Start / stop</span>
            <input
              value={startStopShortcut}
              onBlur={() => {
                if (
                  startStopShortcut.trim().length > 0 &&
                  startStopShortcut !== preferences.shortcuts.startStop
                ) {
                  void store.updatePreferences({
                    shortcuts: { startStop: startStopShortcut.trim() },
                  });
                }
              }}
              onChange={(event) => setStartStopShortcut(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Pause / resume</span>
            <input
              value={pauseResumeShortcut}
              onBlur={() => {
                if (
                  pauseResumeShortcut.trim().length > 0 &&
                  pauseResumeShortcut !== preferences.shortcuts.pauseResume
                ) {
                  void store.updatePreferences({
                    shortcuts: { pauseResume: pauseResumeShortcut.trim() },
                  });
                }
              }}
              onChange={(event) => setPauseResumeShortcut(event.target.value)}
            />
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h3>Support diagnostics</h3>
            <p>Export technical details to investigate capture or performance problems.</p>
          </div>
        </div>
        <div className="diagnostics-export-card">
          <span className="permission-setup-icon">
            <Icon name="activity" />
          </span>
          <div>
            <strong>Privacy-safe support report</strong>
            <p>
              Includes app, macOS, hardware, recent errors, and recording performance summaries.
              Recording content and media file paths are never included.
            </p>
          </div>
          <Button
            disabled={operation !== 'idle'}
            icon="folder"
            variant="secondary"
            onClick={() => void store.exportDiagnostics()}
          >
            {operation === 'exporting-diagnostics' ? 'Exporting…' : 'Export diagnostics'}
          </Button>
        </div>
      </section>
    </div>
  );
}
