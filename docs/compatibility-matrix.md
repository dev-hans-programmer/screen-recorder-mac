# Capture Compatibility Matrix

## Local baseline — 2026-09-30

- Hardware: Mac16,8, Apple Silicon arm64, 24 GiB memory
- macOS: 26.0.1
- Capture inventory: 1 display, 18 windows, 4 applications
- Permission state: Screen Recording and microphone granted; no restart required
- Native encoders: H.264, HEVC, and ProRes profiles reported as hardware-backed
- Report command: `pnpm test:compatibility`

| Scenario                     | Result                | Evidence or follow-up                                                 |
| ---------------------------- | --------------------- | --------------------------------------------------------------------- |
| Single monitor               | Pass                  | Display capture finalized and passed AVFoundation/ffprobe validation. |
| Multiple monitors            | Not available locally | Only one display was attached; rerun on a multi-monitor machine.      |
| Retina coordinate conversion | Pass                  | Native inventory reported 3024×1964 at 2×; 1280×720 crop passed.      |
| Display capture              | Pass                  | 1920×1080 H.264 output was playable.                                  |
| Window capture               | Pass                  | Selected live window finalized and was playable.                      |
| Application capture          | Pass                  | Selected running application finalized and was playable.              |
| Region capture               | Pass                  | 1280×720 crop finalized and was playable.                             |
| System audio only            | Pass                  | One AAC audio track plus video passed both inspectors.                |
| Microphone only              | Pass                  | One AAC microphone track plus video passed both inspectors.           |
| System audio plus microphone | Pass                  | Two AAC audio tracks plus video passed both inspectors.               |
| Sleep/wake during capture    | Manual pending        | Start capture, sleep/wake, stop, and inspect finalization/recovery.   |
| Display disconnect/reconnect | Manual pending        | Requires a second display; verify clear source-failure handling.      |

The matrix distinguishes unsupported local hardware from failure. Generated JSON contains exact
dimensions, duration, file size, media track count, encoded/dropped frames, and queue depth. Attach
that report when testing another Mac rather than overwriting this baseline.
