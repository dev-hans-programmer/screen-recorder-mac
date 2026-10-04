import desktopPackage from '../../package.json';

export const appMetadata = Object.freeze({
  name: 'Screen Recorder',
  version: desktopPackage.version,
  nativeServiceVersion: desktopPackage.version,
  phase: 'Phase 15 · Release readiness',
  platform: 'macOS 15+',
});
