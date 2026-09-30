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
pnpm test:compatibility
pnpm test:performance
pnpm quality:validate "/path/to/recording.mp4"
```

`pnpm make` produces Universal 2 DMG and ZIP installers plus `SHA256SUMS` under
`apps/desktop/out/make`. See [packaging](docs/packaging.md) for build details and
[installation](docs/installation.md) for installing credential-free artifacts. The
[CI/CD guide](docs/ci-cd.md) covers downloadable workflow artifacts and tag releases.

The Electron application includes the native CaptureService protocol, AVAssetWriter recording, the
supervised Electron-to-Swift bridge, and a responsive recorder workspace with library and settings
views. Raw media remains entirely inside the native capture pipeline.
