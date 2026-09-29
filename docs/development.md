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

## Expected Phase 6 behavior

The app opens the foundation screen showing the project name, current version, active platform
target, and that the Electron-to-Swift native bridge is ready. The renderer has access to the typed
`window.screenRecorder` bridge; the full recording workspace is introduced in Phase 7.

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
