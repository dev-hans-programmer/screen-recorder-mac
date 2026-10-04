# Troubleshooting

## App is blocked after downloading

Credential-free CI artifacts are ad-hoc signed, not notarized. Verify `SHA256SUMS`, then follow the
Control-click/Open or Privacy & Security → Open Anyway steps in [installation.md](installation.md).
Do not disable Gatekeeper globally.

## No capture sources or permission still appears denied

Enable Screen Recorder or CaptureService under Privacy & Security → Screen & System Audio
Recording, fully quit the app, then reopen it from Applications. macOS often applies capture access
only to a newly launched process. If the app path changed, remove stale entries and grant the copy
at its stable Applications path. See [preferences-and-permissions.md](preferences-and-permissions.md).

## Microphone is silent or intermittent

Confirm Microphone access for Screen Recorder/CaptureService, choose the intended input in macOS,
disable Bluetooth-device automatic switching where relevant, restart the app, and make a ten-second
test. Export diagnostics after reproducing; an `empty` microphone track means permission existed but
no valid samples reached the writer.

## Recording cannot stop, play, or open in the editor

Wait briefly for native finalization before force-quitting. Confirm the configured output folder is
writable and has free space. Use Reveal in Finder and test the original file in QuickTime. The
editor may create a compatibility preview without modifying the original. A partial file can be
recovered from the Library after interruption.

## Native request times out

A timeout terminates the unresponsive helper; idle read-only operations retry once. Quit and reopen
the app if ScreenCaptureKit was waiting on a permission dialog. Inspect both structured and unified
logs using [native-service-debugging.md](native-service-debugging.md).

## Build or package fails

- Use the Node version from `.node-version` and pnpm version from `packageManager`.
- Run `pnpm install --frozen-lockfile`; after changing Node major, run `pnpm rebuild macos-alias`.
- Run `pnpm version:check` for mismatched app/helper versions.
- Remove generated build output with `pnpm clean`; Swift `.build` is ignored and may be removed
  separately if its cache is stale.
- Confirm Xcode command-line tools are selected with `xcode-select -p`.

When escalating, attach the exported support report, relevant redacted logs, exact reproduction
steps, macOS/hardware details, and the artifact checksum. Never attach private recordings by default.
