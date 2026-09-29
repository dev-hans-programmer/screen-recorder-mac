# ADR-0004: Use ScreenCaptureKit with AVAssetWriter for the Initial Recording Pipeline

- Status: Accepted
- Date: 2026-09-30

## Context

The recorder needs display, window, application, region, system-audio, and microphone capture with accurate timestamps and high-quality local files. The pipeline must support capability-based resolution, FPS, codec, and HDR decisions.

## Decision

Use ScreenCaptureKit for source selection and sample-buffer capture. Use AVAssetWriter in the Swift CaptureService to write synchronized video and audio tracks to MP4 or MOV files.

The initial implementation will favor the explicit `SCStream` plus AVAssetWriter path because it provides control over buffering, timestamps, fallback behavior, audio tracks, diagnostics, and future composition features.

## Alternatives considered

- Browser `MediaRecorder` as the primary encoder.
- Sending sample buffers to JavaScript and encoding in the renderer.
- Using a third-party or external FFmpeg process for the initial capture path.
- Using a direct ScreenCaptureKit recording-output API as the only implementation path.

## Consequences

Positive:

- Native capture and encoding stay outside Electron’s renderer.
- The application controls container, codec, tracks, timestamps, and finalization.
- The pipeline can report actual output statistics.
- Future editing and composition work can build on native media primitives.

Negative:

- AVAssetWriter configuration requires careful media-format testing.
- Codec availability differs between Macs and must be detected.
- Region capture requires correct logical-point to physical-pixel conversion.
- HDR and ProRes support require capability and playback validation.

## Fallback policy

- ProRes → HEVC → H.264.
- Requested 4K60 → 4K30 → 1080p60 → 1080p30.
- HDR → SDR.
- Missing optional audio → video-only or user cancellation.

All fallbacks must be visible to the user and stored in recording diagnostics.
