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

## Expected Phase 1 behavior

The app opens a small foundation screen showing the project name, current version, active platform target, and the fact that native capture has not been implemented yet.
