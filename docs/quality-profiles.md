# Recording Quality Profiles

Quality profiles describe the desired output. The native capture service must still validate the actual hardware, source, codec, display dimensions, and disk conditions before starting.

## Profiles

| Profile           | Container             | Preferred codec            | Intended use                     | Default target                         |
| ----------------- | --------------------- | -------------------------- | -------------------------------- | -------------------------------------- |
| Compatible        | MP4                   | H.264                      | Maximum playback compatibility   | 1080p60 SDR                            |
| Balanced          | MP4                   | HEVC                       | High quality with smaller files  | Source size up to 4K, 30/60 FPS        |
| Master            | MOV                   | ProRes 422 where supported | Editing and maximum quality      | Source size up to 4K, 30/60 FPS        |
| Source resolution | Uses selected profile | Uses selected profile      | Resolution behavior, not a codec | Native source size capped at 3840×2160 |

## Resolution rules

- The maximum output width is 3840 pixels.
- The maximum output height is 2160 pixels.
- Lower-resolution sources must never be upscaled.
- Aspect ratio must be preserved.
- A source larger than 4K is downscaled only when the user selects the 4K maximum.
- The UI must show the actual output dimensions after capability validation.
- Region coordinates must be converted from macOS logical points to physical pixels before capture.

## Frame-rate rules

- Offer 30 FPS and 60 FPS when the source and native pipeline support them.
- Prefer 60 FPS for compatible sources when the user selects it.
- If the requested frame rate cannot be sustained, fall back in this order:
  1. Requested resolution at 30 FPS.
  2. 1080p at the requested frame rate.
  3. 1080p at 30 FPS.
- The UI must report any fallback before recording starts when possible.
- The recording metadata must contain the actual frame rate.

## Codec fallback rules

1. ProRes falls back to HEVC when ProRes is unavailable or disk throughput is insufficient.
2. HEVC falls back to H.264 when hardware support is unavailable.
3. HDR falls back to SDR when the source, operating system, encoder, or output path cannot preserve HDR.
4. The user must see a warning when the selected profile changes.
5. A failed fallback must stop before recording begins rather than silently producing an invalid file.

## Audio behavior

- System audio and microphone audio are configured independently.
- A recording contains video and, when requested, one playback-compatible audio track. If both
  sources are enabled, system audio and microphone are mixed into that track at finalization.
- Audio timestamps must remain synchronized with video timestamps.
- If a requested audio source fails during setup, the app must offer a video-only fallback or cancel according to the user’s choice.
- The recording library must identify which requested audio sources are represented in the output.

## Disk-space policy

- Estimate required space from the selected profile, actual dimensions, FPS, and expected bitrate.
- Reserve a safety margin in addition to the estimated recording size.
- Warn when available space is below 10 GB or below the estimated space for the next five minutes.
- Stop safely and finalize what is possible before the disk is exhausted.
- Never expose a partial file as a completed recording.
- ProRes must display a large-file warning before recording begins.

Exact bitrate settings are implementation details and must be validated in the performance and quality test phase. The profile contract is based on output quality, codec, container, resolution, FPS, and fallback behavior rather than one fixed bitrate value.

## Quality validation

Every profile must be validated for:

- Correct container.
- Correct codec.
- Correct dimensions.
- Correct frame rate.
- Correct audio-track presence.
- Audio/video duration alignment.
- Playback in QuickTime Player.
- File size and disk-write behavior.
- Visual quality of text, cursor movement, and high-motion content.
