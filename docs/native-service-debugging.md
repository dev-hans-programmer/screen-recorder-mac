# Native CaptureService debugging

## Build and test directly

```bash
pnpm native:build
pnpm native:test
pnpm native:run
```

With `native:run`, send one JSON line to verify the protocol:

```json
{
  "protocolVersion": 1,
  "requestId": "debug-hello",
  "command": "hello",
  "payload": { "clientVersion": "0.1.3" }
}
```

The response must use protocol version 1 and report the same service version as `package.json`.
Run `pnpm version:check` if it differs.

## Logs

Electron logs are in the app `userData/logs` directory. Stream native unified logs with:

```bash
log stream --level debug --predicate 'subsystem == "com.screenrecorder.capture-service"'
```

Use Console.app for longer sessions and filter by subsystem. Categories are `capture`, `encoding`,
`audio`, `permissions`, and `protocol`. Paths and sensitive source names are intentionally redacted.

## Packaged helper inspection

```bash
APP="apps/desktop/out/Screen Recorder-darwin-universal/Screen Recorder.app"
file "$APP/Contents/Resources/CaptureService"
lipo -archs "$APP/Contents/Resources/CaptureService"
codesign --verify --deep --strict "$APP"
node scripts/verify-package.mjs
```

The helper must be executable, outside `app.asar`, match the app architectures, answer `hello`, and
report the packaged app version. `verify-package.mjs` checks all of these invariants.

## Diagnosing failures

1. Reproduce with no recording active and send `hello`, `getCapabilities`, then `getHealth`.
2. Distinguish protocol errors, permission denial, source disappearance, encoder failure, and disk
   finalization failure by their stable error codes.
3. Check Screen Recording/Microphone TCC state and restart both Electron and helper after changes.
4. Check free disk space, output-directory permissions, and encoder availability.
5. For a hang, capture a process sample in Activity Monitor before terminating the helper.
6. Export support diagnostics and correlate timestamps across Electron and unified logs.

Never print raw frame/audio data, recording paths, source names, or permission-database contents.
