# Screen Recorder

Native-feeling macOS screen recorder built with React, Electron, TypeScript, and Swift.

## Development

Requirements:

- macOS 15 or newer
- Node.js 24 or newer within the supported range
- pnpm 12
- Xcode command-line tools; the full Xcode app is recommended for native framework debugging

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
pnpm native:build
pnpm native:test
```

The Electron application is currently in the foundation phase. Phase 4 now includes the native
CaptureService protocol, permission inspection, source discovery, configuration validation, and
bounded sample diagnostics. AVAssetWriter encoding is added in the next phase.
