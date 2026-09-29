import type { ReactElement } from 'react';

import { appMetadata } from '../../shared/app-metadata';

const foundationItems = [
  {
    label: 'Desktop shell',
    value: 'Electron 44',
    status: 'ready',
  },
  {
    label: 'UI layer',
    value: 'React 19.3',
    status: 'ready',
  },
  {
    label: 'Native bridge',
    value: 'Electron ↔ Swift',
    status: 'ready',
  },
] as const;

export function App(): ReactElement {
  return (
    <main className="app-shell">
      <section className="hero-panel" aria-labelledby="app-title">
        <div className="eyebrow">{appMetadata.phase}</div>
        <h1 id="app-title">Capture your screen beautifully.</h1>
        <p className="hero-copy">
          The production foundation and native capture bridge are connected. The full recorder
          workspace will be introduced in the next UI phase.
        </p>
        <div className="hero-actions">
          <button className="primary-button" type="button" disabled>
            Start recording
          </button>
          <span className="availability-note">Recorder workspace coming next</span>
        </div>
      </section>

      <section className="status-section" aria-labelledby="foundation-title">
        <div className="section-heading">
          <div>
            <div className="eyebrow">System status</div>
            <h2 id="foundation-title">{appMetadata.name} is ready to grow.</h2>
          </div>
          <span className="version-pill">v{appMetadata.version}</span>
        </div>

        <div className="status-grid">
          {foundationItems.map((item) => (
            <article className="status-card" key={item.label}>
              <div className={`status-dot ${item.status}`} aria-hidden="true" />
              <div>
                <p className="status-label">{item.label}</p>
                <p className="status-value">{item.value}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="app-footer">
        <span>Designed for {appMetadata.platform}</span>
        <span>Responsive native performance is the priority.</span>
      </footer>
    </main>
  );
}
