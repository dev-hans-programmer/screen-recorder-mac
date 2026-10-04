# Known limitations

- macOS 15 or newer is required; Windows, Linux, and older macOS versions are unsupported.
- Default CI artifacts are ad-hoc signed and not notarized, so downloaded builds require the
  documented Gatekeeper approval.
- 4K/60 recording depends on display geometry, encoder availability, free disk throughput, and
  hardware. ProRes produces very large files.
- HDR capture/export is capability-reported but the current product flow is optimized for SDR.
- ScreenCaptureKit permission changes can require a complete app/helper restart.
- Some protected video, DRM content, secure windows, and app-owned overlays cannot be captured.
- Bluetooth microphones can change devices or sample behavior when macOS changes audio mode.
- Editor operations are intentionally lightweight and non-destructive; multi-clip composition,
  transitions, annotations, captions, and arbitrary-speed effects are not included.
- Preview compatibility conversion may take time and use additional temporary disk space.
- Recordings are local files. Cloud sync, team administration, policy deployment, telemetry,
  automatic updates, and remote crash reporting are not implemented.
