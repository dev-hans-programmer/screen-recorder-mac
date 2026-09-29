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

## Validation commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format
```

## Optional development environment variables

Copy `apps/desktop/.env.example` to a local `.env` file only when needed. Do not commit `.env` files.

| Variable                    | Values                                     | Default | Purpose                                    |
| --------------------------- | ------------------------------------------ | ------- | ------------------------------------------ |
| `SCREEN_RECORDER_LOG_LEVEL` | `silent`, `error`, `warn`, `info`, `debug` | `info`  | Controls future main-process logging       |
| `SCREEN_RECORDER_DEVTOOLS`  | `0`, `1`                                   | `0`     | Opens Chromium DevTools during development |

## Expected Phase 9 behavior

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

See [security.md](security.md) for the Electron boundary and IPC rules.

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
