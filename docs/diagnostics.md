# Diagnostics and observability

## Structured application logs

The Electron main process writes newline-delimited JSON to the app's `userData/logs` directory.
`main.jsonl` rotates at 2 MB, and at most five files are retained. The configured
`SCREEN_RECORDER_LOG_LEVEL` controls the minimum level.

Each entry contains a timestamp, level, stable message, and optional structured context. Logging
redacts filesystem paths, recording titles, source names, and device names recursively. Raw audio,
video, thumbnails, preferences, and capture-source lists are never logged.

The log covers application startup and shutdown, recording state transitions, controlled failures,
warnings, helper failures, and final recording performance summaries. High-frequency progress
events are intentionally excluded.

## Native unified logging

CaptureService uses the subsystem `com.screenrecorder.capture-service` with these macOS unified-log
categories:

- `capture`
- `encoding`
- `audio`
- `permissions`
- `protocol`

Inspect the live native log in Console.app or from Terminal:

```bash
log stream --level info --predicate 'subsystem == "com.screenrecorder.capture-service"'
```

Source identifiers and output paths are not written to unified logging. Potentially sensitive
system error descriptions use private hashed interpolation.

## Recording performance summaries

Each completed recording produces a versioned, path-free diagnostic summary containing:

- Actual output width, height, duration, captured frames, encoded frames, and dropped frames.
- Codec and whether the selected encoder was hardware or software.
- System-audio and microphone track state (`disabled`, `active`, or `empty`).
- Final file size plus average and peak observed file-write rates.

The native helper samples the partial output size during existing health polling, so write-rate
measurement does not add another high-frequency timer. Up to 50 recent summaries are persisted in
`userData/diagnostics/recordings.json` for support and performance comparisons.

## Exported support report

Settings → Support diagnostics opens a native save dialog and exports a formatted JSON report. It
contains:

- App, Electron, React, Node, expected/observed Swift helper, capture-protocol, and macOS versions.
- CPU architecture/model, logical CPU count, and total memory.
- Up to 50 recent redacted errors.
- Up to 20 recent path-free recording performance summaries.

The report explicitly excludes recording content, thumbnails, recording filenames and paths,
capture-source names, usernames, preferences, and permission database contents. The report is
created with private file permissions and is only written after the user chooses its destination.
