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
thin. Framework-free core and smoke test executables let protocol, configuration, state, writer, and
invariant checks run from the Command Line Tools SDK even when XCTest is unavailable.

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
- `pauseCapture`
- `resumeCapture`
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

`configureCapture` accepts the capture settings plus the native recording settings below:

```json
{
  "profileId": "compatible",
  "outputDirectory": "/Users/example/Movies/Screen Recorder"
}
```

The profiles are intentionally aligned with the domain package:

- `compatible`: H.264 in MP4, optimized for broad playback compatibility.
- `balanced`: HEVC in MP4, optimized for smaller files at similar visual quality.
- `master`: Apple ProRes 422 in MOV, optimized for editing quality and throughput.

The service reports which profiles have a hardware encoder through
`hardwareEncoderProfileIds`. The writer still validates the selected profile when the recording
starts and returns a structured `ENCODING_UNAVAILABLE` error when the platform cannot create it.

The executable exits when stdin closes, after attempting to stop any active stream. This makes the
parent-process pipe a second cleanup path in addition to the explicit `shutdown` command.

## Native responsibilities

- ScreenCaptureKit source discovery returns stable display, window, and application identifiers.
- Permission inspection distinguishes screen recording and microphone states.
- Capture configuration validates source kind, dimensions, frame rate, regions, and microphone IDs
  before stream startup.
- `AVAssetWriter` receives video, system-audio, and microphone samples on a bounded serial queue.
  Raw samples stay inside Swift; they never cross Electron IPC.
- Recordings are written to a hidden `.partial` file. Only after the writer finishes successfully is
  the file moved into the configured output directory. Failed/interrupted recordings remain marked
  as partial and are never reported as completed library artifacts.
- Pause/resume drops samples while paused and retimes the following samples to remove the pause
  interval from the final timeline.
- H.264, HEVC, and ProRes 422 use profile-specific container, codec, bitrate, and quality settings.
- Audio tracks share the ScreenCaptureKit media clock. Missing audio and delayed microphone samples
  are accepted without blocking video finalization.
- HDR capability is reported conservatively from the display's extended dynamic range support. The
  stream configuration currently defaults to SDR until the Phase 5 encoding profile requests HDR.

The writer supports output dimensions through 7680x4320 at the native configuration boundary. The
actual maximum useful resolution depends on the selected display, encoder availability, GPU, memory,
and disk throughput; 4K validation should be performed on a 4K display with the balanced or master
profile before enabling it as a default.
