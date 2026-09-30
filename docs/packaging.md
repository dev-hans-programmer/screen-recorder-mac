# Packaging

## Requirements

- macOS 15 or newer.
- Node.js 24, as pinned by `.node-version`.
- pnpm 12 and Xcode command-line tools.

Select Node 24 before installing dependencies. Forge's DMG maker contains a native Node module, so
installing dependencies with one Node major and packaging with another can cause an ABI error. If a
working tree was installed with another Node major, switch to Node 24 and run:

```bash
pnpm rebuild macos-alias
```

## Create artifacts

From the repository root:

```bash
pnpm make
```

The command cross-builds `CaptureService` for arm64 and x86_64, combines it into a Universal 2
binary, packages a Universal 2 Electron app, and creates:

- `apps/desktop/out/Screen Recorder-darwin-universal/Screen Recorder.app`
- `apps/desktop/out/make/Screen Recorder-<version>-universal.dmg`
- `apps/desktop/out/make/zip/darwin/universal/Screen Recorder-darwin-universal-<version>.zip`
- `apps/desktop/out/make/SHA256SUMS`

The application code is stored in `app.asar`. The executable native helper is deliberately copied
to `Contents/Resources/CaptureService` outside the ASAR so Electron can launch it directly.
The production macOS icon is generated at all required resolutions in `apps/desktop/assets/icon.icns`
and embedded into the application bundle by Electron Forge.

## Validate artifacts

```bash
pnpm artifacts:verify
node scripts/verify-package.mjs
pnpm test:packaged:probe
```

The checks verify artifact hashes, app-icon and ASAR/helper placement, executable permissions,
matching app and helper architectures, code-signature integrity, packaged renderer startup, and
helper discovery. Use `pnpm test:packaged` on a Mac with Screen Recording permission to include a
short real capture.

## Signing modes

The default build needs no Apple Developer account or secret. It receives an ad-hoc signature so
Universal 2 executables can run locally, but it is neither Developer ID signed nor notarized.
Gatekeeper therefore treats a downloaded default artifact as an unidentified-developer build.

Trusted signing can be enabled later without changing source code:

| Variable                                                   | Purpose                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `SCREEN_RECORDER_MACOS_SIGN_IDENTITY`                      | Developer ID Application identity used by `codesign`                     |
| `SCREEN_RECORDER_MACOS_SIGN_KEYCHAIN`                      | Optional temporary or non-default signing keychain                       |
| `SCREEN_RECORDER_NOTARY_KEYCHAIN_PROFILE`                  | Preferred `notarytool` keychain profile                                  |
| `SCREEN_RECORDER_NOTARY_KEYCHAIN`                          | Optional non-default keychain for that profile                           |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Alternative notarization credential set; all three are required together |

Notarization is enabled only when complete credentials and a signing identity are present. The
credential-free path remains the default for local builds and CI artifacts.

The CI workflow can import a `.p12` into an ephemeral keychain and populate these runtime variables
without storing credentials in source control. See [ci-cd.md](ci-cd.md).
