# CaptureService

`CaptureService` is a macOS Swift executable that owns ScreenCaptureKit interaction. It communicates
with the Electron main process over newline-delimited JSON on stdin/stdout. Logs use `OSLog` so
stdout remains a machine-readable protocol channel.

## Build and smoke test

From the repository root:

```bash
pnpm native:build
pnpm native:test
```

The package targets macOS 15 or newer. The core target is reusable and the executable target is kept
thin so protocol and invariant checks can run from the Command Line Tools SDK without XCTest.

## Protocol

Every request includes `protocolVersion`, `requestId`, `command`, and an optional `payload`. Every
response includes the request correlation id, service version, success state, and either `data` or a
structured error.

Supported commands in this phase:

- `hello`
- `getCapabilities`
- `listSources`
- `getPermissions`
- `requestPermissions`
- `configureCapture`
- `startCapture`
- `stopCapture`
- `getHealth`
- `heartbeat`
- `shutdown`

Example:

```json
{
  "protocolVersion": 1,
  "requestId": "1",
  "command": "hello",
  "payload": { "clientVersion": "0.1.0" }
}
```

The executable exits when stdin closes, after attempting to stop any active stream. This makes the
parent-process pipe a second cleanup path in addition to the explicit `shutdown` command.

## Native responsibilities

- ScreenCaptureKit source discovery returns stable display, window, and application identifiers.
- Permission inspection distinguishes screen recording and microphone states.
- Capture configuration validates source kind, dimensions, frame rate, regions, and microphone IDs
  before stream startup.
- Dedicated ScreenCaptureKit sample queues feed bounded diagnostics. Raw samples stay inside Swift;
  they never cross Electron IPC.
- HDR capability is reported conservatively from the display's extended dynamic range support. The
  stream configuration currently defaults to SDR until the Phase 5 encoding profile requests HDR.
