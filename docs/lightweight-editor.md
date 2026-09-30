# Lightweight Editor

## Scope

The editor provides a fast, non-destructive workflow for one recording at a time:

- set trim-in and trim-out points;
- use the original frame or centered 16:9, 4:3, and square crop presets;
- fine-tune crop position and size;
- rotate the exported image by 0, 90, 180, or 270 degrees;
- add and remove muted timeline ranges;
- select a poster frame for the Library thumbnail; and
- export a new Library item without changing the source recording.

The output keeps the source quality profile and frame rate. Compatible recordings export as MP4,
Balanced recordings prefer HEVC MP4, and Master recordings prefer ProRes MOV. AVFoundation selects
a safe compatible fallback if the requested preset is unavailable.

## Architecture and performance

Edit validation belongs to the library domain. The application use case resolves the source by ID,
blocks export while capture is active, invokes the editor port, and persists the completed output.
The Electron adapter sends only paths and edit metadata to the Swift CaptureService. Swift uses
AVMutableComposition, AVMutableVideoComposition, and AVAssetExportSession, so decoded video frames
do not pass through React, IPC, or JavaScript.

Preview uses the private `screen-recorder-media` protocol. The renderer receives an opaque URL that
contains a recording ID, not a filesystem path. The main process revalidates that ID against the
Library and forwards Chromium range requests to the approved local file. This keeps seeking fluid
without granting renderer filesystem access.

Poster frames are generated from the exported file in Swift, staged under application data, and
atomically imported into the existing thumbnail cache. A poster-cache failure does not discard an
otherwise valid export; the Library can regenerate a thumbnail lazily.

## Current boundaries

- Export is not cancellable after it reaches AVFoundation.
- Mute ranges affect every audio track in the exported recording.
- The editor does not add transitions, overlays, annotations, speed changes, or multiple clips.
- Output codec and quality customization are intentionally deferred to a richer export workflow.

## Manual verification

Use a recording with visible motion and spoken or system audio.

1. Open Library, choose **Actions → Edit**, and confirm preview playback and seeking work.
2. Move In and Out, choose a crop preset, rotate 90 degrees, and verify the output dimensions update.
3. Mark a mute range around audible content and choose a distinct playhead as the thumbnail.
4. Export and confirm the app returns to Library with a second item while the original remains.
5. Play the export in QuickTime and verify duration, crop, orientation, muted interval, and sync.
6. Confirm the new Library card uses the selected frame and that Open and Reveal in Finder work.
7. Repeat with Compatible, Balanced, and Master source recordings when those profiles are available.
8. Start a recording and confirm an editor export is rejected until capture has stopped.
