import { useEffect, type ReactElement } from 'react';

import { appMetadata } from '../../shared/app-metadata';
import { Button, Sidebar, Tooltip } from './components';
import { getRendererStore, useRendererSelector } from './renderer-store';
import { LibraryView, RecorderView, SettingsView } from './views';

const screenTitles = {
  recorder: 'Recorder',
  library: 'Library',
  settings: 'Settings',
} as const;

export function App(): ReactElement {
  const store = getRendererStore();
  const activeScreen = useRendererSelector(store, (state) => state.activeScreen);
  const recordingState = useRendererSelector(store, (state) => state.recordingState);
  const recordingCount = useRendererSelector(store, (state) => state.recordings.length);
  const operation = useRendererSelector(store, (state) => state.operation);
  const theme = useRendererSelector(store, (state) => state.preferences?.theme ?? 'system');
  const error = useRendererSelector(store, (state) => state.error);
  const notice = useRendererSelector(store, (state) => state.notice);

  useEffect(() => {
    void store.initialize();
  }, [store]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
            <div>
              <div className="topbar-kicker">Capture workspace</div>
              <h1>{screenTitles[activeScreen]}</h1>
            </div>
            <div className="topbar-actions">
              <div
                className={`connection-status ${recordingState === 'failed' ? 'is-warning' : ''}`}
              >
                <span className="status-pulse" />
                {operation === 'idle' ? 'Native bridge online' : 'Working'}
              </div>
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
                    <Button
                      aria-label="Dismiss error"
                      icon="circle"
                      variant="icon"
                      onClick={() => store.clearFeedback()}
                    />
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
            {activeScreen === 'recorder' && <RecorderView store={store} />}
            {activeScreen === 'library' && <LibraryView store={store} />}
            {activeScreen === 'settings' && <SettingsView store={store} />}
          </div>

          <footer className="content-footer">
            <span>
              {appMetadata.name} · {appMetadata.version}
            </span>
            <span>Built for focused, fluid capture on {appMetadata.platform}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
