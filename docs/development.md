# Development Setup

## Required tools

- macOS 15 or newer.
- Node.js 24 or another version allowed by the root `package.json` engines field.
- pnpm 12.
- Xcode command-line tools.

The native Swift CaptureService is not part of the Phase 1 scaffold yet, but the Swift toolchain is required before native work begins.

## Install dependencies

From the repository root:

```bash
pnpm install
```

## Run the development application

```bash
pnpm dev
```

The root command delegates to the Electron desktop workspace.

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

## Expected Phase 3 behavior

The app opens the foundation screen showing the project name, current version, active platform
target, and the fact that native capture has not been implemented yet. The renderer also has access
to the typed `window.screenRecorder` bridge, while capture commands remain unavailable until the
Swift service is added.

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

Enter one JSON request per line and press `Ctrl-D` to close stdin. The native service currently
provides source/capability/permission/configuration foundations; encoding and completed recording
files are intentionally deferred to Phase 5.
