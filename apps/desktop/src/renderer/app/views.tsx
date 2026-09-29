import { useEffect, useRef, useState } from 'react';

import type {
  AppPreferencesDto,
  CaptureSourceDto,
  RecordingArtifactDto,
} from '@screen-recorder/contracts';

import { Button, EmptyState, Icon, LoadingState, StatusBadge, Toggle } from './components';
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

  const permissionGranted = permissions?.screenRecording === 'granted';
  const selectedSource = sources.find((source) => source.id === selectedSourceId);
  const canStart = selectedSource !== undefined && permissionGranted && operation === 'idle';
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
          {permissionGranted ? (
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
        <Button icon="folder" variant="secondary">
          Open recordings folder
        </Button>
      </div>
      <section className="library-grid" aria-label="Recordings">
        {recordings.map((recording) => (
          <RecordingCard key={recording.id} recording={recording} />
        ))}
      </section>
    </div>
  );
}

function RecordingCard({ recording }: { readonly recording: RecordingArtifactDto }) {
  return (
    <article className="recording-card">
      <div className="recording-thumbnail">
        <Icon name="play" size={25} />
        <span>{recording.profileId}</span>
      </div>
      <div className="recording-card-body">
        <div className="recording-card-title">
          <h3>{recording.title || 'Untitled recording'}</h3>
          <Button
            aria-label={`More actions for ${recording.title}`}
            icon="sliders"
            variant="icon"
          />
        </div>
        <p>{formatDate(recording.createdAt)}</p>
        <div className="recording-meta">
          <span>
            {recording.width} × {recording.height}
          </span>
          <span>{formatDuration(recording.durationMs)}</span>
          <span>{formatBytes(recording.fileSizeBytes)}</span>
        </div>
      </div>
    </article>
  );
}

const themeOptions = [
  { value: 'system', label: 'System', icon: 'system' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'circle' },
] as const;

export function SettingsView({ store }: { readonly store: RendererStore }) {
  const preferences = useRendererSelector(store, (state) => state.preferences);
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
    </div>
  );
}
