# Performance Targets and Measurement Methodology

These are engineering targets for supported hardware, not guarantees for every Mac. The application must prefer a valid, responsive recording with a visible fallback over an unstable recording that attempts to maintain an unsupported profile.

## Performance principles

- ScreenCaptureKit and AVAssetWriter own the media path.
- React never receives raw video or audio frames.
- Electron IPC carries commands, metadata, and throttled status events only.
- Media queues are bounded.
- Native encoding should use hardware acceleration where the selected codec supports it.
- The renderer must remain responsive while the native helper is recording.
- Performance measurements must record actual output dimensions, FPS, codec, dropped frames, and hardware.

## Target metrics

| Area                    | Target                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Renderer responsiveness | No user-visible input freeze during recording                                                                              |
| Renderer long tasks     | No recurring task longer than 100 ms during recording                                                                      |
| Start/stop feedback     | UI state update within 250 ms after command acknowledgement, excluding permission dialogs                                  |
| Progress events         | No more than 10 events per second sent to the renderer                                                                     |
| 1080p60                 | At most 0.5% dropped video frames on reference Apple Silicon hardware                                                      |
| 4K30                    | At most 0.5% dropped video frames on reference hardware that supports 4K capture                                           |
| 4K60                    | At most 1% dropped video frames on hardware capable of sustaining the profile                                              |
| Audio sync              | Video and audio drift below 100 ms over a 30-minute recording                                                              |
| Memory                  | No unbounded growth; combined app/helper memory should remain within 15% of the steady-state baseline during a 2-hour test |
| Disk writing            | Sustained write capacity should exceed the estimated media bitrate by at least 25%                                         |
| Startup                 | Packaged app should become interactive within 2.5 seconds on reference Apple Silicon hardware                              |

If a target cannot be met, the app must report the limitation and apply the documented fallback policy.

## Reference test classes

Use actual hardware available to the project, but record tests under these classes:

1. Apple Silicon entry-level laptop.
2. Apple Silicon Pro desktop or laptop.
3. Apple Silicon high-performance machine.
4. Intel Mac capable of running the minimum supported macOS.
5. Retina display configuration.
6. Multiple-monitor configuration.

The exact device model, memory, macOS version, display dimensions, and display refresh rate must be stored with each test result.

## Test scenarios

### Capture matrix

- 1080p30 for 10 minutes.
- 1080p60 for 10 minutes.
- 4K30 for 10 minutes.
- 4K60 for 10 minutes where supported.
- Full display capture.
- Window capture.
- Application capture.
- Region capture.
- Cursor enabled and disabled.
- System audio only.
- Microphone only.
- System audio plus microphone.

### Stress matrix

- 30-minute recording.
- 2-hour recording.
- Low disk-space warning.
- Display disconnect and reconnect.
- macOS sleep and wake.
- Source window closing during recording.
- Native helper termination.
- Renderer reload while idle.
- Multiple recordings in one app session.

### UI matrix

- Main window at minimum supported dimensions.
- Main window resized during recording.
- Light mode and dark mode.
- Reduced-motion setting enabled.
- Large recording library.
- Keyboard-only control flow.
- Menu-bar-only control flow.

## Measurement procedure

For each recording test:

1. Record the hardware and OS details.
2. Record the selected source and requested profile.
3. Record the actual dimensions, FPS, codec, and audio tracks.
4. Record dropped-frame count and native warnings.
5. Record app and helper CPU/memory behavior.
6. Record file size and sustained disk-write behavior.
7. Inspect playback and audio/video synchronization.
8. Store the result with a pass, fallback, or failure classification.

During development, use macOS Activity Monitor, Console, native `OSLog`, application logs, and the app’s diagnostic report. Automated media inspection will be added in the quality-validation tasks.

## Regression policy

- A change must not introduce recurring renderer stalls.
- A change must not increase dropped frames on the same reference machine and profile without an accepted explanation.
- A change must not introduce unbounded queue or memory growth.
- A change that affects capture or encoding must include a before/after performance result.
- Performance regressions must be fixed or documented before release-candidate testing.
