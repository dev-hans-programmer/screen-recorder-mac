# macOS Screen Recorder — End-to-End Implementation Tasks

This document is the implementation roadmap for the screen recorder. Each task is intentionally scoped so it can be implemented and verified independently. Complete tasks from top to bottom unless a task explicitly says it can be done in parallel.

## Project goals

- Build a polished macOS screen recorder using React, Electron, TypeScript, and Swift.
- Support display, window, application, and region recording.
- Support system audio and optional microphone recording.
- Support recording up to 4K and 60 FPS when the Mac and source support it.
- Keep capture and encoding native so the React UI remains responsive.
- Use a domain-driven, clean architecture.
- Produce downloadable CI artifacts that can be installed locally.
- Keep Apple Developer credentials, signing, and notarization optional for now.

## Working conventions

- Use strict TypeScript.
- Keep domain code independent from React, Electron, Node.js, and Swift.
- Use comments for non-obvious decisions, platform workarounds, coordinate conversions, permission behavior, and performance invariants.
- Do not add comments that merely restate obvious code.
- Every completed task must include tests or a documented reason why automated testing is not practical.
- Every task that changes user-visible behavior must update the relevant documentation.
- Do not send raw video or audio frames through JavaScript or Electron IPC.

## Definition of done

A task is complete when:

- The implementation is committed in the correct architectural layer.
- Type checking, linting, and relevant tests pass.
- The feature has been manually verified on macOS when it depends on native APIs.
- Failure states are handled and surfaced to the user where appropriate.
- Logging does not expose sensitive recording paths or user content unnecessarily.
- The task checkbox is checked and its acceptance criteria are satisfied.

## Phase 0 — Product and platform decisions

- [x] T001 Document the initial macOS support matrix.
  - Decide the minimum macOS version.
  - Define whether the first release targets Apple Silicon only or Universal 2.
  - Document supported and unsupported capture scenarios.
  - Acceptance: `docs/platform-support.md` exists with explicit support and fallback behavior.

- [x] T002 Define the first-release feature scope.
  - Required: display, window/application, region, system audio, microphone toggle, pause/resume, stop, output directory, recent recordings, global shortcut.
  - Deferred: webcam overlay, annotations, editing timeline, cloud upload, live streaming, team features.
  - Acceptance: `docs/product-scope.md` clearly separates v1 and later features.

- [x] T003 Define recording quality profiles.
  - Compatible: H.264/MP4.
  - Balanced: HEVC/MP4.
  - Master: ProRes/MOV where supported.
  - Source mode: native source size capped at 4K.
  - Acceptance: `docs/quality-profiles.md` documents profile limits, codec fallback rules, and disk-space expectations.

- [x] T004 Define performance targets and measurement methodology.
  - Define expected behavior for 1080p60, 4K30, and 4K60.
  - Define acceptable dropped-frame thresholds.
  - Define UI responsiveness, memory, CPU, GPU, and disk-throughput targets.
  - Acceptance: `docs/performance.md` contains measurable targets and test scenarios.

- [x] T005 Create initial architecture decision records.
  - Record the Swift helper decision.
  - Record the no-frame-crossing-IPC decision.
  - Record the Electron Forge decision.
  - Record the native capture and encoding decisions.
  - Acceptance: ADRs exist under `docs/adr/`.

## Phase 1 — Repository and toolchain foundation

- [x] T010 Initialize the package workspace.
  - Create the root `package.json`.
  - Configure pnpm workspaces.
  - Add package scripts for development, type checking, linting, testing, packaging, and native builds.
  - Acceptance: a clean checkout can install dependencies successfully.

- [x] T011 Configure TypeScript.
  - Enable strict mode.
  - Configure project references or package-level configs.
  - Prevent accidental imports from renderer code into Electron main code.
  - Acceptance: invalid layer imports fail during type checking.

- [x] T012 Configure Electron Forge and Vite.
  - Create development, package, and make commands.
  - Configure separate entry points for main, preload, and renderer.
  - Configure development hot reload for the renderer.
  - Acceptance: a basic Electron window starts with one command and packages locally.

- [x] T013 Configure code quality tooling.
  - Add ESLint.
  - Add Prettier.
  - Add import ordering and unused-code checks.
  - Add pre-commit or CI validation.
  - Acceptance: formatting, linting, and type checking run from package scripts.

- [x] T014 Configure test tooling.
  - Add Vitest for domain and application tests.
  - Add Playwright or an equivalent Electron-capable test runner for UI flows.
  - Add XCTest configuration for Swift code.
  - Acceptance: each test suite has a documented command and a passing smoke test.

- [x] T015 Add environment and configuration handling.
  - Separate development, test, and production configuration.
  - Avoid relying on undeclared environment variables.
  - Document all supported environment variables.
  - Acceptance: the app starts with a safe default configuration when optional variables are absent.

## Phase 2 — Domain model and application layer

- [x] T020 Create the domain package.
  - Add bounded contexts for capture, recording, library, preferences, and permissions.
  - Add value objects for dimensions, frame rate, file paths, durations, codec profiles, and capture regions.
  - Acceptance: domain package has no Electron, React, Node.js, or browser imports.

- [x] T021 Implement capture domain models.
  - Model displays, windows, running applications, and regions.
  - Model source capabilities and selection state.
  - Model capture permissions.
  - Acceptance: capture entities and invariants have unit tests.

- [x] T022 Implement recording domain models.
  - Add recording session states:
    `Idle → Preparing → Capturing → Paused → Stopping → Completed | Failed`.
  - Model recording metadata, quality profile, audio options, and statistics.
  - Acceptance: illegal state transitions are rejected and tested.

- [x] T023 Implement domain errors.
  - Add typed errors for permission denial, unsupported codec, invalid source, insufficient disk space, helper failure, and finalization failure.
  - Acceptance: application code can distinguish recoverable and non-recoverable errors.

- [x] T024 Define application ports.
  - `CapturePort`
  - `RecordingEnginePort`
  - `PermissionPort`
  - `RecordingRepository`
  - `SettingsRepository`
  - `FileSystemPort`
  - `Clock`
  - `Logger`
  - Acceptance: ports describe behavior without depending on concrete infrastructure.

- [x] T025 Implement application use cases.
  - `ListCaptureSources`
  - `CheckCapturePermissions`
  - `RequestCapturePermissions`
  - `ValidateRecordingRequest`
  - `StartRecording`
  - `PauseRecording`
  - `ResumeRecording`
  - `StopRecording`
  - `RecoverInterruptedRecording`
  - `ListRecordings`
  - `UpdatePreferences`
  - Acceptance: use cases are tested with fake ports.

- [x] T026 Define application events.
  - Recording state changes.
  - Recording progress.
  - Dropped-frame warnings.
  - Disk-space warnings.
  - Permission changes.
  - Native-service failures.
  - Acceptance: event payloads are serializable and versionable.

## Phase 3 — Shared contracts and Electron boundaries

- [x] T030 Create shared IPC contracts.
  - Define commands, responses, events, errors, and protocol version.
  - Use runtime schemas for validation.
  - Acceptance: invalid payloads are rejected before reaching application services.

- [x] T031 Implement the secure preload API.
  - Expose only purpose-built methods through `contextBridge`.
  - Do not expose `ipcRenderer`, filesystem access, shell access, or arbitrary channel access.
  - Add typed event subscription cleanup.
  - Acceptance: renderer code can call approved APIs but cannot access Node.js or Electron internals.

- [x] T032 Configure Electron security defaults.
  - Enable context isolation.
  - Disable Node integration in renderers.
  - Enable renderer sandboxing.
  - Configure a restrictive content security policy.
  - Restrict navigation and new-window creation.
  - Validate IPC senders.
  - Acceptance: security configuration is tested and documented.

- [x] T033 Implement main-process dependency composition.
  - Construct repositories, native service clients, use cases, loggers, and IPC controllers in one composition root.
  - Keep infrastructure wiring out of domain and UI code.
  - Acceptance: dependencies can be replaced with fakes in tests.

- [x] T034 Implement main-process lifecycle management.
  - Single-instance lock.
  - App startup and shutdown.
  - Window lifecycle.
  - Graceful recording shutdown.
  - Native helper cleanup.
  - Acceptance: closing or quitting the app does not leave orphan native processes.

## Phase 4 — Swift CaptureService

- [x] T040 Create the Swift Package or Xcode target.
  - Add `ScreenCaptureKit`, `AVFoundation`, `CoreMedia`, `CoreAudio`, `AppKit`, and `OSLog` dependencies.
  - Define a release build configuration.
  - Acceptance: native service builds on a clean macOS machine.

- [x] T041 Implement the native command protocol.
  - Add request decoding.
  - Add response encoding.
  - Add request IDs.
  - Add structured native errors.
  - Add service version negotiation.
  - Acceptance: the service can respond to `hello`, `getCapabilities`, and `shutdown`.

- [x] T042 Implement native service process control.
  - Add clean startup and shutdown.
  - Handle stdin/stdout or Unix socket closure.
  - Handle unexpected parent-process termination.
  - Add heartbeat and health state.
  - Acceptance: the service exits cleanly and reports failures without hanging.

- [x] T043 Implement ScreenCaptureKit source discovery.
  - Enumerate displays.
  - Enumerate windows.
  - Enumerate running applications.
  - Return stable source identifiers and display scale information.
  - Acceptance: TypeScript receives accurate source metadata for single and multi-monitor setups.

- [x] T044 Implement permission inspection and request flow.
  - Detect Screen Recording permission.
  - Detect microphone permission when needed.
  - Return actionable permission states.
  - Handle cases where macOS requires an app restart after permission changes.
  - Acceptance: denied, granted, and not-yet-requested states are distinguishable.

- [x] T045 Implement capture configuration.
  - Configure source filter.
  - Configure width and height.
  - Configure source and destination rectangles.
  - Configure 30/60 FPS.
  - Configure cursor visibility.
  - Configure mouse-click indicators when supported.
  - Configure system audio and microphone capture.
  - Configure SDR/HDR capability detection.
  - Acceptance: configuration is validated before capture begins.

- [x] T046 Implement native frame and audio output handling.
  - Use dedicated queues or actors for video and audio.
  - Validate sample buffers.
  - Preserve timestamps.
  - Bound all queues.
  - Track dropped frames and late samples.
  - Acceptance: native diagnostics report frame and audio health without unbounded memory growth.

## Phase 5 — Native encoding and file finalization

- [x] T050 Implement AVAssetWriter session creation.
  - Create video and audio tracks.
  - Configure container and codec.
  - Configure dimensions and frame rate.
  - Configure bitrate or quality settings per profile.
  - Acceptance: a short recording opens correctly in QuickTime Player.

- [x] T051 Implement H.264/MP4 recording.
  - Add compatibility profile.
  - Add hardware-encoder capability detection.
  - Add fallback errors.
  - Acceptance: H.264 recordings play on supported macOS players.

- [x] T052 Implement HEVC/MP4 recording.
  - Add balanced profile.
  - Validate 4K behavior.
  - Validate file size and quality.
  - Acceptance: HEVC recordings play correctly and are smaller than equivalent H.264 recordings in the expected cases.

- [x] T053 Implement ProRes/MOV recording where supported.
  - Add master-quality profile.
  - Warn about large file sizes.
  - Validate disk throughput requirements.
  - Acceptance: supported Macs can produce a valid high-quality MOV file.

- [x] T054 Implement audio synchronization.
  - Synchronize system audio and microphone tracks.
  - Handle absent audio streams.
  - Handle microphone start delays.
  - Acceptance: audio remains synchronized during short and long recordings.

- [x] T055 Implement temporary-file and finalization behavior.
  - Write to a `.partial` or temporary file.
  - Finalize the asset writer before exposing the file to the library.
  - Atomically move the completed file into the configured output directory.
  - Acceptance: failed recordings are not presented as completed recordings.

- [x] T056 Implement pause and resume.
  - Preserve a continuous final timeline.
  - Avoid encoding unwanted frames during pause.
  - Report paused duration accurately.
  - Acceptance: a paused recording resumes correctly without broken timestamps.

- [x] T057 Implement interruption and recovery.
  - Handle app quit.
  - Handle helper crash.
  - Handle display disconnect.
  - Handle sleep/wake.
  - Handle disk-full conditions.
  - Acceptance: users receive a clear result and recoverable files are handled safely.

## Phase 6 — Electron native bridge

- [x] T060 Implement the TypeScript `CaptureServiceClient`.
  - Spawn the Swift helper from the Electron main process.
  - Resolve the helper path in development and packaged builds.
  - Implement request correlation.
  - Implement timeouts and cancellation.
  - Implement event parsing.
  - Acceptance: the client passes protocol tests against a fake helper.

- [x] T061 Implement native-service supervision.
  - Restart the helper only when safe.
  - Prevent duplicate recording sessions.
  - Surface helper crashes to the application layer.
  - Acceptance: killing the helper produces a controlled application state.

- [x] T062 Implement source and capability mapping.
  - Convert Swift DTOs into domain models.
  - Map native codec capabilities to quality profiles.
  - Map native errors to domain errors.
  - Acceptance: no native types leak beyond the infrastructure adapter.

- [x] T063 Implement recording orchestration.
  - Connect application use cases to the native bridge.
  - Publish application events to the renderer through typed IPC.
  - Throttle progress events.
  - Acceptance: the complete start/pause/resume/stop flow works without renderer frame traffic.

## Phase 7 — React application shell and design system

- [x] T070 Create the application shell.
  - Add dashboard layout.
  - Add navigation between recorder, library, and settings.
  - Add loading, empty, error, and permission states.
  - Acceptance: all primary screens render from a clean launch.

- [x] T071 Create the design system.
  - Add color, spacing, typography, radii, shadows, and motion tokens.
  - Add light, dark, and system themes.
  - Add reusable buttons, toggles, cards, dialogs, menus, tooltips, and status indicators.
  - Acceptance: UI components are consistent and keyboard accessible.

- [x] T072 Add macOS window styling.
  - Configure hidden or inset title bar behavior.
  - Add appropriate vibrancy/transparency where stable.
  - Respect safe areas and display scaling.
  - Acceptance: the app feels visually native on supported macOS versions.

- [x] T073 Add responsive behavior.
  - Define minimum window dimensions.
  - Support compact and expanded layouts.
  - Use CSS container queries where helpful.
  - Support reduced motion.
  - Acceptance: the app remains usable at minimum and large window sizes.

- [x] T074 Add renderer state management.
  - Keep domain state transitions in application logic.
  - Keep transient UI state in the renderer store.
  - Avoid rerendering the whole application on timer or progress changes.
  - Acceptance: React profiler shows localized updates during recording.

## Phase 8 — Source selection and recording controls

- [x] T080 Implement source picker screen.
  - Display sources with names, icons, dimensions, and type.
  - Add refresh behavior.
  - Handle sources disappearing.
  - Acceptance: display, window, and application sources can be selected.

- [x] T081 Implement region-selection overlay.
  - Add transparent always-on-top selection window.
  - Support drag selection and keyboard adjustment.
  - Display pixel dimensions and aspect ratio.
  - Convert logical coordinates to physical capture coordinates.
  - Ensure the overlay is excluded from the recording.
  - Acceptance: selected regions align correctly on Retina and multi-monitor displays.

- [x] T082 Implement recording configuration controls.
  - Add quality profile selection.
  - Add resolution selection.
  - Add FPS selection.
  - Add cursor and click indicators.
  - Add system audio and microphone toggles.
  - Add output location selection.
  - Acceptance: controls produce validated native recording requests.

- [x] T083 Implement recording control surface.
  - Add start, pause, resume, and stop.
  - Add elapsed timer.
  - Add current profile and source summary.
  - Add disk-space indicator.
  - Add dropped-frame warning state.
  - Acceptance: controls remain responsive throughout a recording.

- [x] T084 Implement global shortcuts and menu-bar controls.
  - Add configurable start/stop shortcut.
  - Add pause/resume shortcut.
  - Add menu-bar status item.
  - Handle shortcut conflicts gracefully.
  - Acceptance: recording can be controlled without focusing the main window.

## Phase 9 — Recording library

- [x] T090 Define recording metadata schema.
  - Store path, title, duration, dimensions, FPS, codec, audio tracks, creation date, and file size.
  - Store failure and recovery metadata where applicable.
  - Acceptance: metadata schema is versioned.

- [x] T091 Implement the recording repository.
  - Use SQLite or another durable local metadata store.
  - Keep recordings on the filesystem.
  - Use atomic metadata updates.
  - Acceptance: metadata survives app restarts and corruption is handled safely.

- [x] T092 Implement thumbnail generation.
  - Generate thumbnails off the renderer thread.
  - Avoid loading full recordings into memory.
  - Cache thumbnails.
  - Acceptance: the library remains smooth with many recordings.

- [x] T093 Implement library UI.
  - Add grid/list views.
  - Add sorting and search.
  - Add rename, reveal in Finder, open, and delete actions.
  - Add missing-file handling.
  - Acceptance: library actions are safe and clearly confirmed where destructive.

## Phase 10 — Preferences and onboarding

- [x] T100 Implement preferences storage.
  - Store output directory.
  - Store quality defaults.
  - Store audio defaults.
  - Store shortcuts.
  - Store theme preference.
  - Acceptance: settings persist across restarts.

- [x] T101 Implement first-run onboarding.
  - Explain Screen Recording permission.
  - Explain microphone permission when selected.
  - Provide buttons to open System Settings.
  - Detect permission changes.
  - Acceptance: a new user can reach a successful first recording without guessing.

- [x] T102 Implement permission recovery flows.
  - Handle permission denial.
  - Handle permission revocation.
  - Handle required restart.
  - Handle source-specific capture failures.
  - Acceptance: every permission failure has a useful next action.

## Phase 11 — Diagnostics, logging, and observability

- [ ] T110 Add structured TypeScript logging.
  - Log lifecycle, state transitions, failures, and performance summaries.
  - Redact sensitive paths where appropriate.
  - Rotate logs.
  - Acceptance: logs are useful without containing raw media or unnecessary personal data.

- [ ] T111 Add native OS logging.
  - Use `OSLog` categories for capture, encoding, audio, permissions, and protocol.
  - Acceptance: native failures can be investigated from Console or exported diagnostics.

- [ ] T112 Add recording diagnostics.
  - Actual width and height.
  - Actual frame count and duration.
  - Dropped frames.
  - Codec and encoder used.
  - Audio track state.
  - Average and peak file-write rate.
  - Acceptance: diagnostics are available for support and performance testing.

- [ ] T113 Add an exportable diagnostics report.
  - Include app version, Electron version, macOS version, hardware summary, and recent errors.
  - Exclude recording content.
  - Acceptance: user can export a support report without exposing media files.

## Phase 12 — Testing and quality validation

- [ ] T120 Add domain unit tests.
  - Test value objects.
  - Test recording state transitions.
  - Test profile validation.
  - Test region bounds and coordinate conversion.
  - Acceptance: core business rules are covered without Electron or macOS dependencies.

- [ ] T121 Add application use-case tests.
  - Test success paths.
  - Test permission failures.
  - Test native-service failures.
  - Test disk-space failures.
  - Test cancellation and recovery.
  - Acceptance: use cases pass using fake ports.

- [ ] T122 Add IPC contract tests.
  - Test valid requests.
  - Test invalid requests.
  - Test unknown protocol versions.
  - Test event cleanup.
  - Acceptance: protocol changes fail safely and are version-aware.

- [ ] T123 Add Swift unit and integration tests.
  - Test protocol parsing.
  - Test configuration validation.
  - Test state transitions.
  - Test writer finalization behavior.
  - Acceptance: native tests run in CI on macOS.

- [ ] T124 Add packaged-app smoke tests.
  - Launch the packaged app.
  - Verify renderer loading.
  - Verify helper discovery.
  - Verify a short recording.
  - Verify the output file exists and is playable.
  - Acceptance: the packaged app passes a basic end-to-end recording test.

- [ ] T125 Add compatibility tests.
  - Test single monitor.
  - Test multiple monitors.
  - Test Retina scaling.
  - Test window capture.
  - Test application capture.
  - Test region capture.
  - Test system audio only.
  - Test microphone only.
  - Test system audio plus microphone.
  - Test sleep/wake and display disconnect scenarios.
  - Acceptance: results are recorded in a compatibility matrix.

- [ ] T126 Add performance tests.
  - 1080p60 recording.
  - 4K30 recording.
  - 4K60 recording where supported.
  - Long-duration recording.
  - Large-library scrolling.
  - Helper restart and recovery.
  - Acceptance: results meet or clearly document deviations from `docs/performance.md`.

- [ ] T127 Add quality validation tools.
  - Inspect output dimensions.
  - Inspect frame rate.
  - Inspect audio/video duration.
  - Detect missing or corrupted tracks.
  - Verify playback in QuickTime Player and at least one additional player.
  - Acceptance: CI or local scripts can validate a generated recording.

## Phase 13 — Packaging and local installation

- [ ] T130 Package the native helper outside the ASAR archive.
  - Include development and packaged paths.
  - Ensure executable permissions are preserved.
  - Acceptance: packaged Electron app can launch the helper.

- [ ] T131 Configure macOS artifacts.
  - Generate `.app`.
  - Generate `.dmg`.
  - Generate `.zip`.
  - Generate checksums.
  - Acceptance: artifacts can be downloaded and installed locally.

- [ ] T132 Make signing and notarization optional.
  - Do not require Apple Developer secrets for the default CI path.
  - Allow signing/notarization configuration through optional CI secrets later.
  - Keep the build usable for local development and artifact testing without credentials.
  - Acceptance: CI succeeds when signing secrets are absent.

- [ ] T133 Document first-run installation behavior.
  - Explain how to open the downloaded app.
  - Explain expected macOS permission prompts.
  - Document any Gatekeeper behavior for unsigned builds.
  - Acceptance: `docs/installation.md` lets a user install and run a downloaded artifact.

## Phase 14 — CI/CD and artifact publishing

- [ ] T140 Create the CI workflow.
  - Run on macOS runners.
  - Install the selected Node.js and pnpm versions.
  - Install dependencies from the lockfile.
  - Build the Swift helper.
  - Run linting, type checking, unit tests, and native tests.
  - Acceptance: pull requests receive a clear pass/fail result.

- [ ] T141 Add packaged-artifact CI jobs.
  - Build the Electron app.
  - Package the native helper.
  - Generate DMG, ZIP, and checksum files.
  - Run packaged-app smoke tests where the runner allows it.
  - Acceptance: every selected branch can produce downloadable artifacts.

- [ ] T142 Publish CI artifacts.
  - Upload `.dmg`.
  - Upload `.zip`.
  - Upload checksums.
  - Upload logs on failure.
  - Acceptance: artifacts are available from the CI run and can be downloaded locally.

- [ ] T143 Add release publishing.
  - Publish artifacts for version tags.
  - Generate release notes from commits or task metadata.
  - Preserve previous artifacts.
  - Acceptance: a version tag creates a downloadable release.

- [ ] T144 Add optional signing/notarization hooks.
  - Keep credentials in CI secrets only.
  - Do not put credentials in the repository.
  - Skip these steps cleanly when secrets are absent.
  - Acceptance: unsigned artifact publishing remains functional.

- [ ] T145 Add CI caching and reproducibility.
  - Cache package-manager dependencies safely.
  - Cache Swift build artifacts where useful.
  - Pin tool versions.
  - Upload build metadata.
  - Acceptance: repeated CI runs are deterministic within expected upstream differences.

## Phase 15 — Release readiness

- [ ] T150 Add version management.
  - Keep Electron, React, Swift helper, and application versions visible in diagnostics.
  - Add a version bump process.
  - Acceptance: packaged artifacts report the correct version everywhere.

- [ ] T151 Add changelog and migration handling.
  - Document user-visible changes.
  - Version preferences and metadata schemas.
  - Add migrations for future releases.
  - Acceptance: upgrades do not lose settings or recording metadata.

- [ ] T152 Perform release-candidate testing.
  - Test clean install.
  - Test upgrade install.
  - Test permission onboarding.
  - Test recording recovery.
  - Test artifact download and launch.
  - Acceptance: release checklist is completed on a clean macOS machine.

- [ ] T153 Create operational documentation.
  - Installation guide.
  - Troubleshooting guide.
  - Permission guide.
  - Performance guide.
  - Known limitations.
  - Native-service debugging guide.
  - Acceptance: a new developer can run, test, package, and diagnose the app.

## Recommended implementation order

Implement one vertical slice first:

1. T010–T015: repository and toolchain.
2. T020–T026: domain and application contracts.
3. T040–T046: Swift source discovery and basic capture.
4. T050–T055: native file recording.
5. T060–T063: Electron-to-Swift bridge.
6. T070–T084: usable React recorder UI.
7. T090–T102: library and preferences.
8. T120–T127: tests and performance validation.
9. T130–T145: packaging and CI artifact publishing.
10. T150–T153: release readiness.

The first meaningful milestone is a packaged Electron app that can select a display, record a short H.264 video with system audio, finalize it correctly, and expose the result in the UI. Everything else should build on that vertical slice.
