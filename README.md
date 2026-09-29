# Screen Recorder

Native-feeling macOS screen recorder built with React, Electron, TypeScript, and Swift.

## Development

Requirements:

- macOS 15 or newer
- Node.js 24 or newer within the supported range
- pnpm 12
- Xcode command-line tools for future native CaptureService work

Install dependencies and start the Electron development app:

```bash
pnpm install
pnpm dev
```

Useful commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format
pnpm package
pnpm make
```

The application is currently in the foundation phase. Native capture is added in a later phase.
