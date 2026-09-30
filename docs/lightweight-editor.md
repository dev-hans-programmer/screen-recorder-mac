# Lightweight Editor

## Scope

The editor provides a timeline-first, non-destructive workflow for one recording at a time:

- set trim-in and trim-out points;
- use the original frame or centered 16:9, 4:3, and square crop presets;
- fine-tune crop position and size;
- rotate the exported image by 0, 90, 180, or 270 degrees;
- add and remove muted timeline ranges;
- select a poster frame for the Library thumbnail; and
- export a new Library item without changing the source recording.

The workspace is arranged like a compact nonlinear editor: canvas and transport controls sit above
a ruler-based video/audio timeline, with frame and export settings in an inspector. The timeline
supports horizontal zoom and scrolling, click/drag scrubbing, draggable trim and mute handles, a
poster-frame marker, and context menus on clips and mute ranges. Space toggles playback; arrow keys
seek by half a second, or five seconds while Shift is held.

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

Electron cannot reliably decode HEVC or ProRes sources. The first time one of these recordings is
opened, the Swift service creates a cached, 1280-pixel, 60 FPS H.264 editing proxy using
AVFoundation. The
preview protocol streams that disposable proxy, while all trims, crops, audio edits, thumbnails, and
exports continue to use the untouched full-quality source. Compatible H.264 sources stream directly.

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

1. Open Library, choose **Actions → Edit**, and confirm canvas playback and timeline scrubbing work.
2. Drag both yellow clip edges, zoom and horizontally scroll the timeline, then verify the playhead
   stays synchronized with the preview.
3. Right-click the video clip and exercise Set In, Set Out, Add Mute, and Set Thumbnail actions.
4. Drag both edges of a mute range, then right-click it and verify its range-specific menu.
5. Choose a crop preset, rotate 90 degrees, and verify the output dimensions update.
6. Mark a mute range around audible content and choose a distinct playhead as the thumbnail.
7. Export and confirm the app returns to Library with a second item while the original remains.
8. Play the export in QuickTime and verify duration, crop, orientation, muted interval, and sync.
9. Confirm the new Library card uses the selected frame and that Open and Reveal in Finder work.
10. Repeat with Compatible, Balanced, and Master sources when those profiles are available.
