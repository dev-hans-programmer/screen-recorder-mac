# ADR-0001: Use a Swift CaptureService for Media Capture

- Status: Accepted
- Date: 2026-09-30

## Context

The app must record macOS displays, windows, applications, audio, and microphones at high quality while keeping the React interface responsive. The most performance-sensitive work is receiving sample buffers, synchronizing audio and video, encoding, and writing media files.

## Decision

Implement a native Swift `CaptureService` using ScreenCaptureKit and AVFoundation. The Electron main process will start and supervise the helper through a typed command/event protocol.

## Alternatives considered

- Record entirely through browser APIs in the React renderer.
- Use Electron desktop-capture APIs as the primary production pipeline.
- Use a native Node.js addon loaded into Electron.
- Use an external command-line encoder as the primary capture engine.

## Consequences

Positive:

- Native access to ScreenCaptureKit, CoreMedia, audio APIs, and hardware encoders.
- Media processing is isolated from the renderer.
- Swift can preserve timestamps and avoid unnecessary pixel copies.
- Native failures and process crashes can be supervised independently.

Negative:

- The project must maintain Swift build and packaging steps.
- The native helper must be built for every supported architecture.
- macOS-specific testing is required.
- The Electron-to-Swift protocol must remain versioned and compatible.

## Implementation constraints

- The helper must be buildable in development and CI.
- The helper must be discoverable in both unpackaged and packaged applications.
- The helper must not expose raw sample buffers to JavaScript.
- The helper must report actual capabilities and output statistics.
