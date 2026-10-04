# Changelog

User-visible changes are recorded here using [Keep a Changelog](https://keepachangelog.com/) style.
Versions follow semantic versioning while the application is pre-1.0.

## Unreleased

### Added

- Centralized application/native-helper version management and packaged-version verification.
- Ordered migrations for preferences and the recording catalog.
- Release-candidate checklist and operations, troubleshooting, limitations, and native-debugging
  guides.
- React, Electron, Node, application, native-helper, protocol, and macOS versions in support
  diagnostics.

### Changed

- Reworked the application into a quieter, preview-first macOS studio with reduced visual chrome.
- Replaced the Recorder marketing hero and competing cards with a capture stage, source-type strip,
  unified inspector, docked record action, and compact recording HUD.
- Refined Library, Settings, and Editor surfaces around the same spacing, material, hierarchy, and
  responsive design system.

## 0.1.3 - 2026-10-04

### Added

- Timeline-based lightweight editor with trim, crop, rotation, mute ranges, poster selection, and
  non-destructive export.
- Reliable editor previews for recordings that Chromium cannot decode directly.

## 0.1.2 - 2026-10-04

### Added

- Production macOS application icon.
- Native folder picker for the recording location.

## 0.1.1 - 2026-10-04

### Fixed

- Intermittent microphone capture/playback behavior.
- Library action menus hiding rename and delete on smaller windows.
- Permission recovery after macOS privacy settings change.

## 0.1.0 - 2026-10-04

### Added

- Native Swift ScreenCaptureKit recorder with hardware-accelerated H.264, HEVC, and ProRes output.
- Electron/React recorder, recording library, preferences, diagnostics, automated tests, packaging,
  and GitHub Actions artifacts.
