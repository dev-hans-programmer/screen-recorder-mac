# Platform Support Matrix

This document defines the platform target for the first production release. The goal is to provide a predictable, high-quality macOS experience while allowing the recorder to reduce quality when the hardware cannot sustain the requested profile.

## Initial release target

| Area                        | Decision                                             |
| --------------------------- | ---------------------------------------------------- |
| Operating system            | macOS 15.0 or newer                                  |
| CPU architecture            | Universal 2: Apple Silicon arm64 and Intel x86_64    |
| Primary performance target  | Apple Silicon Macs                                   |
| UI runtime                  | Electron 44.x with React 19.x                        |
| Capture framework           | ScreenCaptureKit                                     |
| Encoding framework          | AVFoundation / AVAssetWriter                         |
| Distribution format         | Downloadable `.dmg` and `.zip` CI artifacts          |
| Apple Developer credentials | Not required for the default CI artifact workflow    |
| First release channel       | Direct downloadable artifacts, not the Mac App Store |

## Required permissions

The app must request permissions only when the related feature is used.

| Permission       | Required for                                     | Behavior when unavailable                            |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Screen Recording | Display, window, application, and region capture | Block recording and provide a System Settings action |
| Microphone       | Microphone recording                             | Allow video-only or system-audio-only recording      |
| Camera           | Not required in v1                               | Camera overlay is deferred                           |

The app must explain that macOS may require a restart after Screen Recording permission is enabled.

## Supported capture scenarios

The first release must support:

- Full-display recording.
- Individual-window recording.
- Application recording where ScreenCaptureKit exposes the application.
- User-selected rectangular region recording.
- Single and multiple monitor setups.
- Retina and non-Retina displays.
- 30 FPS and 60 FPS where supported.
- Output up to 4K (`3840 × 2160`) without upscaling lower-resolution sources.
- Optional system-audio recording.
- Optional microphone recording.
- Cursor visibility control.
- Mouse-click indicators where supported by the selected macOS APIs.
- Light mode, dark mode, and system appearance.

## Quality and hardware behavior

The app must detect capabilities before recording and choose a safe fallback when necessary.

| Requested capability        | Preferred behavior                                                       | Fallback                                             |
| --------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| 4K60                        | Record at 4K60 using a supported hardware encoder                        | 4K30, then 1080p60                                   |
| HEVC                        | Use HEVC when supported                                                  | H.264/MP4                                            |
| ProRes                      | Use ProRes/MOV when supported and selected                               | HEVC or H.264                                        |
| HDR                         | Preserve HDR only when the source, OS, codec, and output path support it | SDR capture                                          |
| System audio                | Capture system audio when available                                      | Continue without system audio and show a warning     |
| Microphone                  | Capture the selected input device                                        | Continue without microphone audio and show a warning |
| Low disk space              | Warn before and during recording                                         | Stop safely before the disk is exhausted             |
| Thermal or encoder pressure | Maintain a valid recording                                               | Lower FPS or resolution and report the change        |

The app must never silently upscale a source. If a display is larger than 4K, the default maximum output is 4K while preserving aspect ratio.

## Architecture implications

- The Swift CaptureService is the only component allowed to process video and audio sample buffers.
- React and Electron IPC exchange commands, metadata, and throttled status events only.
- Native helper binaries must be built for both arm64 and x86_64 for the Universal 2 target.
- Native helper discovery must work in development and from the packaged application.
- Capability detection must be exposed through the application layer rather than hardcoded in React components.
- The UI must display the actual selected output dimensions and FPS instead of assuming that the requested profile was achieved.

## Unsupported or deferred scenarios

These scenarios are not required for the first release:

- macOS versions older than macOS 15.
- Mac App Store distribution.
- Webcam overlays.
- Live streaming.
- Built-in video editing or timeline composition.
- Cloud upload or collaboration features.
- DRM-protected or otherwise capture-protected content that macOS does not expose to ScreenCaptureKit.
- Guaranteed 4K60 recording on every supported Mac.

When macOS or an application intentionally protects content, the recorder must report the limitation rather than attempting to bypass it.

## Future compatibility work

After the first release is stable, evaluate:

1. A macOS 14 compatibility mode using the subset of ScreenCaptureKit APIs available there.
2. More granular codec and HDR support based on device capability testing.
3. Broader performance tuning for older Intel Macs.
4. Optional signed and notarized distribution using CI secrets.

## Manual verification for this task

Before moving to T002, confirm the following decisions:

- The app targets macOS 15 or newer.
- Universal 2 is the intended artifact architecture.
- Apple Silicon is the primary performance target.
- The first CI workflow may produce downloadable artifacts without Apple Developer credentials.
- The supported and deferred capture scenarios above match the intended product.
