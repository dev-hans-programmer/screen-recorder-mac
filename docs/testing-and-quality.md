# Testing and Quality Validation

Phase 12 uses deterministic tests for business rules and opt-in macOS hardware suites for capture,
encoding, and playback. Hardware reports are written under `validation-results/`; that directory is
ignored because results identify a particular machine and belong in CI artifacts or test records.

## Automated quality gate

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format
```

`pnpm test` runs Vitest and both Swift native test executables. The native checks cover protocol
parsing, configuration validation, service state transitions, writer finalization, diagnostics, and
profile invariants. They intentionally avoid XCTest so the same suite runs with either full Xcode or
Apple's Command Line Tools-only CI image.

## Output-file validation

Install `ffprobe` (provided by Homebrew's `ffmpeg` package), then inspect a completed recording:

```bash
pnpm quality:validate "/path/to/recording.mp4"
pnpm quality:validate "/path/to/recording.mp4" --quicktime
```

The native `MediaInspector` uses AVFoundation—the same media stack used by QuickTime—to check
playability, dimensions, nominal FPS, duration, codecs, and track counts. `ffprobe` independently
demuxes the file. Optional expectation flags used by the hardware suite also detect a missing system
audio or microphone track. `--quicktime` opens the file for the final visual/listening check.

## Hardware validation

```bash
pnpm test:hardware:probe
pnpm test:compatibility
pnpm test:performance
node scripts/hardware-validation.mjs --performance --include-long \
  --output validation-results/performance-long.json
```

The probe is read-only. Compatibility records short display, region, window, and application
captures plus supported audio combinations. Performance records 1080p60 and adds 4K30/4K60 only
when the discovered source supports 4K. The long test is deliberately opt-in because it runs for 30
minutes. Keep visible motion on the recorded source when measuring frame delivery; a static desktop
is legitimately emitted as sparse ScreenCaptureKit frames.

The compatibility audio cases play a generated tone so the system-audio track has measurable
duration; microphone cases use the currently selected macOS input device.

Sleep/wake, monitor disconnect, and a two-hour soak remain manual because automating them would
mutate the developer's system state. Record those outcomes in the compatibility matrix.

## Packaged smoke test

Package with the repository's pinned Node 24 runtime, then run:

```bash
pnpm package
pnpm test:packaged
```

The smoke runner launches the `.app` with isolated user data, verifies renderer loading and packaged
helper discovery, records for two seconds, and validates the output with AVFoundation and ffprobe.
The packaged app has its own macOS permission identity; if prompted, grant Screen Recording,
restart the packaged app, and rerun. `pnpm test:packaged:probe` skips capture for restricted CI
runners while still validating launch, renderer, and helper packaging.
