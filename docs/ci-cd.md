# CI/CD and artifact publishing

The GitHub Actions workflow is defined in `.github/workflows/ci.yml`. It uses a pinned macOS 15
runner, Node.js from `.node-version`, pnpm 12.5.1, frozen lockfile installation, and commit-pinned
actions.

## Workflow triggers

| Trigger         | Quality gates | DMG/ZIP artifacts  | GitHub Release |
| --------------- | ------------- | ------------------ | -------------- |
| Pull request    | Yes           | Yes, ad-hoc signed | No             |
| Push to `main`  | Yes           | Yes                | No             |
| Manual dispatch | Yes           | Yes                | No             |
| `v*` tag        | Yes           | Yes                | Yes            |

Pull requests never receive signing or notarization secrets. Branch, tag, and manually dispatched
builds use credentials only when the complete optional secret set is configured. With no secrets,
the workflow cleanly produces the same installable ad-hoc-signed build as `pnpm make`.

## Quality and packaging jobs

The **Quality gates** job installs from `pnpm-lock.yaml`, builds the Swift helper, and runs type
checking, linting, formatting, React/Electron tests, and native Swift tests.

After quality gates pass, **Universal 2 package** builds arm64 and x86_64 Swift binaries, packages
the Universal 2 app, generates DMG/ZIP/checksum files, verifies app/helper architectures and code
signatures, and attempts the no-recording packaged startup probe. The probe is reported as a warning
when a hosted runner cannot launch a GUI app; structural and checksum verification remain required.

Open a workflow run in GitHub and download the artifact named
`screen-recorder-macos-<run-id>-<attempt>`. It contains:

- Universal 2 DMG.
- Universal 2 ZIP.
- `SHA256SUMS`.

Build metadata is uploaded separately for 30 days. It records the commit, app version, Node, pnpm,
Swift, Xcode and macOS versions, lockfile hash, signing mode, artifact sizes, and SHA-256 hashes. Logs
from a failed quality, package, or release job are retained for seven days.

## Tagged releases

A tag whose name starts with `v` publishes the DMG, ZIP, flattened checksum manifest, and build
metadata as GitHub Release assets. Release notes are generated from commits. Rerunning the same tag
updates only that tag's assets; older releases remain untouched.

Example after the corresponding application version is committed:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Optional signing and notarization

No secrets are required for the default workflow. To enable trusted distribution later, configure
these GitHub Actions repository or environment secrets:

| Secret                         | Required for | Description                                    |
| ------------------------------ | ------------ | ---------------------------------------------- |
| `MACOS_CERTIFICATE_P12_BASE64` | Signing      | Base64-encoded Developer ID Application `.p12` |
| `MACOS_CERTIFICATE_PASSWORD`   | Signing      | Password protecting that `.p12`                |
| `MACOS_SIGN_IDENTITY`          | Signing      | Exact Developer ID Application identity        |
| `APPLE_ID`                     | Notarization | Apple account used by `notarytool`             |
| `APPLE_APP_SPECIFIC_PASSWORD`  | Notarization | App-specific password                          |
| `APPLE_TEAM_ID`                | Notarization | Apple Developer team identifier                |

All three signing secrets must be present together. All three notarization secrets must also be
present together, and notarization requires signing. An incomplete configuration fails with a clear
message instead of silently publishing an artifact with an unexpected trust level.

The certificate is imported into a temporary runner keychain and removed after packaging. Secrets
are not written to build metadata, logs, artifacts, or repository files.

## Caching and reproducibility

- `actions/setup-node` caches pnpm's content-addressed store using `pnpm-lock.yaml`.
- Separate Swift caches are keyed by runner OS, architecture, job purpose, and Swift package files.
- Node, pnpm, actions, the macOS runner major, and dependency versions are pinned.
- `SOURCE_DATE_EPOCH` comes from the source commit.
- Build metadata records hosted-runner toolchain details that GitHub may update within a macOS image.

These controls make repeated builds traceable and deterministic within unavoidable Apple/GitHub
toolchain and signing timestamp differences.
