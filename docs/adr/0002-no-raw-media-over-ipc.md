# ADR-0002: Never Send Raw Media Frames Through JavaScript IPC

- Status: Accepted
- Date: 2026-09-30

## Context

4K60 video produces a large volume of data. Copying frames through Swift, Electron main, preload, and React would increase CPU usage, memory pressure, garbage collection, latency, and the probability of dropped frames.

## Decision

The Swift CaptureService owns the complete media path from ScreenCaptureKit sample buffers through encoding and file finalization. Electron IPC transports only commands, metadata, errors, progress, warnings, and final recording information.

## Protocol rules

- Commands are request/response messages with correlation IDs.
- Events are structured and throttled before reaching the renderer.
- No event contains raw video frames, audio buffers, image blobs, or unbounded payloads.
- Recording progress is rate-limited to a maximum of 10 events per second.
- The final event contains the completed file metadata and diagnostic summary.

## Consequences

Positive:

- Lower renderer CPU and memory usage.
- Reduced IPC overhead.
- Better 4K and 60 FPS stability.
- Clear separation between media processing and presentation.

Negative:

- A live high-resolution preview is not part of the first recording pipeline.
- Preview or annotation features will require a separate, explicitly designed native path.
- Diagnostics must be collected natively and summarized for the UI.
