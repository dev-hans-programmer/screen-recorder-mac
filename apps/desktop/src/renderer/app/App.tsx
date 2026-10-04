import { useEffect, type ReactElement } from 'react';

import { Button, Sidebar, Tooltip } from './components';
import { getRendererStore, useRendererSelector, type RecoveryAction } from './renderer-store';
import { LibraryView, OnboardingView, RecorderView, SettingsView } from './views';
import { EditorView } from '../editor/EditorView';

const screenTitles = {
  recorder: 'Recorder',
  library: 'Library',
  editor: 'Editor',
  settings: 'Settings',
} as const;

const recoveryLabels: Readonly<Record<RecoveryAction, string>> = {
  'open-screen-settings': 'Open System Settings',
  'open-microphone-settings': 'Open System Settings',
  'restart-application': 'Restart Capture',
  'refresh-sources': 'Refresh sources',
};

export function App(): ReactElement {
  const store = getRendererStore();
  const activeScreen = useRendererSelector(store, (state) => state.activeScreen);
  const recordingState = useRendererSelector(store, (state) => state.recordingState);
  const recordingCount = useRendererSelector(store, (state) => state.recordings.length);
  const operation = useRendererSelector(store, (state) => state.operation);
  const initialized = useRendererSelector(store, (state) => state.initialized);
  const theme = useRendererSelector(store, (state) => state.preferences?.theme ?? 'system');
  const onboarding = useRendererSelector(
    store,
    (state) => state.preferences?.onboardingCompleted === false,
  );
  const error = useRendererSelector(store, (state) => state.error);
  const notice = useRendererSelector(store, (state) => state.notice);
  const recoveryAction = useRendererSelector(store, (state) => state.recoveryAction);

  useEffect(() => {
    void store.initialize();
  }, [store]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!initialized) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible') void store.refreshPermissions(true);
    };
    const interval = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [initialized, store]);

  return (
    <div className="app-shell" data-theme={theme}>
      <div className="app-layout">
        <aside className="sidebar-column">
          <div className="traffic-light-safe-area" aria-hidden="true" />
          <div className="sidebar-content">
            <Sidebar
              activeScreen={activeScreen}
              recordingCount={recordingCount}
              recordingState={recordingState}
              onSelect={(screen) => store.setActiveScreen(screen)}
            />
          </div>
        </aside>

        <main className="content-region">
          <header className="topbar window-drag-region">
            <div className="topbar-title">
              <h1>{onboarding ? 'Welcome' : screenTitles[activeScreen]}</h1>
              <span>
                {onboarding
                  ? 'A quick setup before your first recording'
                  : activeScreen === 'recorder'
                    ? 'Choose a source and start capturing'
                    : activeScreen === 'library'
                      ? `${recordingCount} saved ${recordingCount === 1 ? 'recording' : 'recordings'}`
                      : activeScreen === 'editor'
                        ? 'Shape and export your recording'
                        : 'Recording defaults and app preferences'}
              </span>
            </div>
            <div className="topbar-actions">
              {operation !== 'idle' && <div className="topbar-activity">Working…</div>}
              <Tooltip label="Open settings">
                <Button
                  aria-label="Open settings"
                  icon="settings"
                  variant="icon"
                  onClick={() => store.setActiveScreen('settings')}
                />
              </Tooltip>
            </div>
          </header>

          <div className="content-scroll">
            {(error !== null || notice !== null) && (
              <div className="feedback-stack" aria-live="polite">
                {error !== null && (
                  <div className="feedback feedback-error">
                    <span>{error}</span>
                    <div className="feedback-actions">
                      {recoveryAction !== null && (
                        <Button variant="secondary" onClick={() => store.runRecoveryAction()}>
                          {recoveryLabels[recoveryAction]}
                        </Button>
                      )}
                      <Button
                        aria-label="Dismiss error"
                        icon="circle"
                        variant="icon"
                        onClick={() => store.clearFeedback()}
                      />
                    </div>
                  </div>
                )}
                {notice !== null && (
                  <div className="feedback feedback-notice">
                    <span>{notice}</span>
                    <Button
                      aria-label="Dismiss notification"
                      icon="circle"
                      variant="icon"
                      onClick={() => store.clearFeedback()}
                    />
                  </div>
                )}
              </div>
            )}
            {onboarding ? (
              <OnboardingView store={store} />
            ) : (
              <>
                {activeScreen === 'recorder' && <RecorderView store={store} />}
                {activeScreen === 'library' && <LibraryView store={store} />}
                {activeScreen === 'editor' && <EditorView store={store} />}
                {activeScreen === 'settings' && <SettingsView store={store} />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
