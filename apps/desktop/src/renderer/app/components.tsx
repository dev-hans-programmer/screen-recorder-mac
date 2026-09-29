import { useEffect, type ButtonHTMLAttributes, type ReactNode, type SVGProps } from 'react';

import type { AppScreen, Operation } from './renderer-store';

type IconName =
  | 'activity'
  | 'archive'
  | 'chevron-right'
  | 'circle'
  | 'folder'
  | 'grid'
  | 'mic'
  | 'monitor'
  | 'pause'
  | 'play'
  | 'settings'
  | 'sliders'
  | 'sparkles'
  | 'stop'
  | 'sun'
  | 'system'
  | 'window';

const iconPaths: Record<IconName, string> = {
  activity: 'M3 12h4l2.1-6 4.2 12 2.1-6H21',
  archive: 'M4 7h16M6 4h12l2 3v13H4V7l2-3Zm4 7h4',
  'chevron-right': 'm9 18 6-6-6-6',
  circle: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
  folder: 'M3.5 6.5h6l2 2h9v9.5h-17V6.5Z',
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  mic: 'M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Zm-6 8a6 6 0 0 0 12 0m-6 6v3m-3 0h6',
  monitor: 'M4 5h16v10H4V5Zm5 14h6m-3-4v4',
  pause: 'M8 5v14m8-14v14',
  play: 'm8 5 11 7-11 7V5Z',
  settings:
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m9-8h-2M5 12H3m15.36-6.36-1.42 1.42M7.06 16.94l-1.42 1.42m12.72 0-1.42-1.42M7.06 7.06 5.64 5.64',
  sliders: 'M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-5 2v4',
  sparkles:
    'm12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Zm6 12 .6 2.4L21 18l-2.4.6L18 21l-.6-2.4L15 18l2.4-.6L18 15Z',
  stop: 'M6 6h12v12H6V6Z',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.42-1.42M4.92 19.08l1.42-1.42m0-11.32L4.92 4.92m14.16 14.16-1.42-1.42M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  system: 'M4 5h16v10H4V5Zm4 14h8m-4-4v4',
  window: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 4h16',
};

export function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size} {...props}>
      <path
        d={iconPaths[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';

export function Button({
  children,
  className = '',
  icon,
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly icon?: IconName;
  readonly variant?: ButtonVariant;
}) {
  return (
    <button className={`button button-${variant} ${className}`.trim()} {...props}>
      {icon !== undefined && <Icon name={icon} size={variant === 'icon' ? 18 : 16} />}
      {children !== undefined && <span>{children}</span>}
    </button>
  );
}

export function Toggle({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}) {
  return (
    <label className={`toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <span>{label}</span>
      <input
        aria-label={label}
        checked={checked}
        disabled={disabled}
        role="switch"
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  readonly children: ReactNode;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function NavItem({
  icon,
  label,
  screen,
  activeScreen,
  onSelect,
  badge,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly screen: AppScreen;
  readonly activeScreen: AppScreen;
  readonly onSelect: (screen: AppScreen) => void;
  readonly badge?: number;
}) {
  const active = screen === activeScreen;
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={`nav-item ${active ? 'is-active' : ''}`}
      type="button"
      onClick={() => onSelect(screen)}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

export function Sidebar({
  activeScreen,
  recordingState,
  recordingCount,
  onSelect,
}: {
  readonly activeScreen: AppScreen;
  readonly recordingState: string;
  readonly recordingCount: number;
  readonly onSelect: (screen: AppScreen) => void;
}) {
  const recording = ['preparing', 'capturing', 'paused', 'stopping'].includes(recordingState);
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand window-drag-region">
        <div className="brand-mark">
          <Icon name="sparkles" size={17} />
        </div>
        <div>
          <div className="brand-name">Capture</div>
          <div className="brand-subtitle">Screen Recorder</div>
        </div>
      </div>

      <nav className="main-nav">
        <div className="nav-heading">Workspace</div>
        <NavItem
          activeScreen={activeScreen}
          icon="monitor"
          label="Recorder"
          screen="recorder"
          onSelect={onSelect}
        />
        <NavItem
          activeScreen={activeScreen}
          badge={recordingCount}
          icon="archive"
          label="Library"
          screen="library"
          onSelect={onSelect}
        />
      </nav>

      <div className="sidebar-bottom">
        <div className={`sidebar-status ${recording ? 'is-recording' : ''}`}>
          <span className="status-pulse" aria-hidden="true" />
          <span>{recording ? 'Recording in progress' : 'Ready to capture'}</span>
        </div>
        <NavItem
          activeScreen={activeScreen}
          icon="settings"
          label="Settings"
          screen="settings"
          onSelect={onSelect}
        />
        <div className="sidebar-version">Native capture · 4K ready</div>
      </div>
    </aside>
  );
}

export function Topbar({
  title,
  operation,
  recordingState,
  onSettings,
}: {
  readonly title: string;
  readonly operation: Operation;
  readonly recordingState: string;
  readonly onSettings: () => void;
}) {
  const recording = ['preparing', 'capturing', 'paused', 'stopping'].includes(recordingState);
  const busy = operation !== 'idle';
  return (
    <header className="topbar window-drag-region">
      <div>
        <div className="topbar-kicker">Workspace</div>
        <h1>{title}</h1>
      </div>
      <div className="topbar-actions">
        <StatusBadge tone={recording ? 'danger' : 'success'}>
          <span className="status-badge-dot" aria-hidden="true" />
          {busy ? 'Working' : recording ? 'Recording' : 'Ready'}
        </StatusBadge>
        <Button aria-label="Open settings" icon="settings" variant="icon" onClick={onSettings} />
      </div>
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action !== undefined && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading recorder' }: { readonly label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function SurfaceCard({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <section className={`surface-card ${className}`.trim()}>{children}</section>;
}

export function Tooltip({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <span className="tooltip-wrap">
      <span className="tooltip-target">{children}</span>
      <span className="tooltip-content" role="tooltip">
        {label}
      </span>
    </span>
  );
}

export function Menu({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="menu">
      <summary className="button button-secondary">
        <span>{label}</span>
        <Icon name="chevron-right" size={14} />
      </summary>
      <div className="menu-popover" role="menu">
        {children}
      </div>
    </details>
  );
}

export function MenuItem({
  children,
  onSelect,
}: {
  readonly children: ReactNode;
  readonly onSelect?: () => void;
}) {
  return (
    <button className="menu-item" role="menuitem" type="button" onClick={onSelect}>
      {children}
    </button>
  );
}

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-describedby={description === undefined ? undefined : 'dialog-description'}
        aria-labelledby="dialog-title"
        aria-modal="true"
        className="dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description !== undefined && <p id="dialog-description">{description}</p>}
          </div>
          <Button aria-label="Close dialog" icon="circle" variant="icon" onClick={onClose} />
        </div>
        {children}
      </section>
    </div>
  );
}
