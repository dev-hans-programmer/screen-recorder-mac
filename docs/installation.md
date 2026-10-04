# Installing a downloaded build

Phase 13 artifacts support macOS 15 or newer and contain both Apple Silicon and Intel code.

## Verify the download

Download the DMG or ZIP together with `SHA256SUMS`. Calculate the artifact hash:

```bash
shasum -a 256 "/path/to/Screen Recorder-<version>-universal.dmg"
```

Confirm that the result exactly matches the artifact's line in `SHA256SUMS`. If the CI download
preserves the directory structure from the manifest, `shasum -a 256 -c SHA256SUMS` verifies every
artifact at once. Do not open a file whose checksum differs.

## Install

For the DMG:

1. Open the DMG.
2. Drag **Screen Recorder** into **Applications**.
3. Eject the disk image.

For the ZIP, double-click it and move **Screen Recorder.app** into **Applications**. Running the app
from Applications gives macOS permissions a stable application path across launches.

## First launch and Gatekeeper

The default CI artifact is ad-hoc signed, not Apple Developer ID signed or notarized. This is
expected because the artifact workflow does not require Apple Developer credentials.

1. In Finder, Control-click **Screen Recorder** in Applications and choose **Open**.
2. Choose **Open** again in the confirmation dialog if macOS offers it.
3. If macOS blocks the app, open **System Settings → Privacy & Security**, find the message for
   Screen Recorder, select **Open Anyway**, authenticate, and confirm **Open**.

Do not disable Gatekeeper globally. If macOS still reports that a checksum-verified build is damaged
or cannot be opened, remove quarantine only from this exact app and then repeat the Control-click
flow:

```bash
xattr -dr com.apple.quarantine "/Applications/Screen Recorder.app"
```

Only use that fallback for an artifact whose checksum you trust.

## Recording permissions

On first run, the setup screen requests Screen Recording access and, only if wanted, microphone
access. macOS may require the app to be quit and reopened after access changes.

- Enable the app under **System Settings → Privacy & Security → Screen & System Audio Recording**.
- Enable it under **Privacy & Security → Microphone** only for microphone capture.
- If macOS lists `CaptureService` instead of Screen Recorder, enable that entry; it is the bundled
  native recorder used by the app.

After changing either permission, fully quit Screen Recorder, reopen it from Applications, refresh
the source list, and make a short test recording. Permission recovery actions are also available in
the app's Settings page.

To update, quit the app and replace the existing copy in Applications with the newer one. Recordings
are stored outside the application bundle and are not removed when the app is replaced.
