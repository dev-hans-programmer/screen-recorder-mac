# First-Release Product Scope

## Product promise

The first release is a focused, native-feeling macOS screen recorder. A user can choose what to capture, select audio and quality options, start recording from the main window or a global shortcut, and receive a playable recording without the interface becoming unresponsive.

The first release prioritizes reliable capture, responsive controls, high-quality output, and a clear local recording library. Editing, sharing, and collaboration are intentionally outside the initial product boundary.

## V1 capabilities

### Capture sources

- Full display.
- Individual window.
- Application when exposed by ScreenCaptureKit.
- User-selected rectangular region.
- Single and multiple monitor setups.
- Retina and non-Retina displays.

### Recording controls

- Start recording.
- Pause recording.
- Resume recording.
- Stop and finalize recording.
- Global start/stop shortcut.
- Global pause/resume shortcut.
- Menu-bar controls.
- Cursor visibility toggle.
- Mouse-click indicator where supported.

### Audio

- System audio toggle.
- Microphone toggle.
- Microphone input selection.
- Video-only recording when audio is unavailable.
- Clear warnings when a requested audio source cannot be captured.

### Quality

- H.264/MP4 compatibility profile.
- HEVC/MP4 balanced profile.
- ProRes/MOV master profile where supported.
- 30 FPS and 60 FPS where supported.
- Output up to 4K without upscaling lower-resolution sources.
- Capability-aware fallback when the requested profile cannot be sustained.

### Recording library

- Recent recordings list.
- Thumbnail.
- Duration, dimensions, FPS, codec, audio-track, file-size, and creation-date metadata.
- Open recording.
- Reveal recording in Finder.
- Rename recording.
- Delete recording with confirmation.
- Missing-file state when a recording was moved outside the app.

### Preferences

- Output directory.
- Default quality profile.
- Default resolution and FPS.
- Default audio options.
- Global shortcut configuration.
- Light, dark, and system appearance.

### Onboarding and permissions

- First-run explanation of Screen Recording permission.
- Microphone permission explanation when microphone capture is enabled.
- Direct action to open the relevant System Settings page.
- Permission state detection and recovery guidance.
- Explanation when macOS requires an application restart after permission changes.

## Primary user flows

### First recording

1. User opens the app.
2. App explains required permissions.
3. User grants Screen Recording permission.
4. User selects a display, window, application, or region.
5. User chooses quality and audio options.
6. App validates capabilities and disk space.
7. User starts recording.
8. App shows a compact control surface and timer.
9. User stops recording.
10. App finalizes the file and shows it in the library.

### Quick recording

1. User invokes the global start shortcut.
2. App uses the saved source and quality preferences.
3. App starts recording if permissions and capabilities are valid.
4. User invokes the stop shortcut.
5. App finalizes the file and presents a completion notification.

### Failed or degraded recording

1. App detects a permission, codec, disk, audio, or performance problem.
2. App explains the problem in plain language.
3. App offers the safest recovery action.
4. If recording can continue safely, the app reports the actual downgraded profile.
5. If recording cannot continue, the app finalizes or preserves a recoverable partial file where possible.

## Deferred features

The following are intentionally deferred until the core recorder is stable:

- Webcam overlay.
- Camera framing and background effects.
- Annotations, drawing, and cursor emphasis editor.
- Video editing timeline.
- Trimming, cropping, and export presets.
- Cloud upload.
- Team sharing and collaboration.
- Live streaming.
- Automatic transcription.
- Mobile or Windows versions.
- Mac App Store distribution.

## Explicit non-goals for V1

- Bypassing DRM or capture-protected content.
- Guaranteeing 4K60 on every Mac.
- Capturing content that macOS does not expose to ScreenCaptureKit.
- Sending raw media frames through the React renderer.
- Requiring an internet connection for local recording.
- Requiring an account or cloud service.

## V1 acceptance criteria

- A user can complete a first recording without reading developer documentation.
- The recorder supports the capture sources defined in the platform support matrix.
- Start, pause, resume, and stop remain responsive during recording.
- A completed recording is playable in QuickTime Player.
- The library shows the completed recording after app restart.
- Permission failures provide an actionable recovery path.
- Capability fallback is visible and never silently changes the requested result.
- CI can produce a downloadable artifact without Apple Developer credentials.
