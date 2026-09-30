# Development Setup

## Required tools

- macOS 15 or newer.
- Node.js 24 or another version allowed by the root `package.json` engines field.
- pnpm 12.
- Xcode command-line tools.

The native Swift CaptureService is built and launched by the Electron main process. The Swift
toolchain is required for local development and packaging.

## Install dependencies

From the repository root:

```bash
pnpm install
```

## Run the development application

```bash
pnpm dev
```

The root command builds the Swift helper and then starts the Electron desktop workspace. This keeps
the development helper path deterministic across fresh checkouts.

## Build installable artifacts

```bash
pnpm make
pnpm artifacts:verify
```

This builds the Swift service and Electron application for Apple Silicon and Intel, then emits a
Universal 2 DMG, ZIP, and checksum manifest. Apple Developer credentials are not needed. Use the
Node version in `.node-version` before installing dependencies or packaging. See
[packaging.md](packaging.md) for signing options and [installation.md](installation.md) for the
first-run flow.

GitHub Actions runs the same quality and packaging flow for pull requests, `main`, manual runs, and
version tags. See [ci-cd.md](ci-cd.md) for artifact downloads, release behavior, caching, and the
optional signing secret contract.

## Validation commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format
pnpm test:hardware:probe
pnpm quality:validate "/path/to/recording.mp4"
```

## Optional development environment variables

Copy `apps/desktop/.env.example` to a local `.env` file only when needed. Do not commit `.env` files.

| Variable                    | Values                                     | Default | Purpose                                    |
| --------------------------- | ------------------------------------------ | ------- | ------------------------------------------ |
| `SCREEN_RECORDER_LOG_LEVEL` | `silent`, `error`, `warn`, `info`, `debug` | `info`  | Controls future main-process logging       |
| `SCREEN_RECORDER_DEVTOOLS`  | `0`, `1`                                   | `0`     | Opens Chromium DevTools during development |

## Expected Phase 11 behavior

The app opens a responsive recorder workspace with Recorder, Library, and Settings navigation. The
workspace loads native capture sources, supports display/window/application selection, region
selection on Retina displays, per-recording quality and audio controls, pause/resume/stop, global
shortcuts, and a menu-bar control. Capture controls use the typed `window.screenRecorder` bridge;
raw video and audio frames never cross into React. The native helper remains responsible for capture,
encoding, disk diagnostics, and finalization.

Completed captures persist in a versioned SQLite catalog and appear in the Library after restarts.
The Library supports cached native thumbnails, grid/list layouts, search, sorting, rename, open,
Reveal in Finder, recoverable Trash deletion, and missing-file handling. See
[recording-library.md](recording-library.md) for storage and safety details.

Library items can also open the non-destructive lightweight editor. The editor supports trim, crop,
90-degree rotation, mute ranges, and poster-frame selection, then exports through AVFoundation as a
new Library item. See [lightweight-editor.md](lightweight-editor.md) for its architecture and manual
checks.

Preferences now survive restarts in a versioned, atomic JSON store. A first-run setup explains
Screen Recording and optional microphone access, while Recorder and Settings expose recovery
actions for denied or revoked access, required helper restarts, and stale capture sources. See
[preferences-and-permissions.md](preferences-and-permissions.md) for storage and recovery behavior.

The main process now emits rotated, redacted structured logs; CaptureService emits categorized
macOS unified logs; and every completed recording retains path-free performance diagnostics. A user
can export a privacy-safe JSON support report from Settings. See
[diagnostics.md](diagnostics.md) for fields, retention, privacy rules, and Console inspection.

See [security.md](security.md) for the Electron boundary and IPC rules.
See [testing-and-quality.md](testing-and-quality.md) for packaged, compatibility, performance, and
media-file validation, and [compatibility-matrix.md](compatibility-matrix.md) for recorded results.

## Native CaptureService commands

```bash
pnpm native:build
pnpm native:test
```

To run the service directly for protocol inspection:

```bash
pnpm native:run
```

Enter one JSON request per line and press `Ctrl-D` to close stdin. The Electron main process starts
the same helper automatically, correlates requests, maps native DTOs into domain ports, and keeps
raw media entirely inside Swift.
