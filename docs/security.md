# Electron Security Boundary

Phase 3 keeps the renderer isolated from Electron and operating-system capabilities.

- The renderer runs with context isolation, no Node.js integration, and sandboxing enabled.
- The preload exposes purpose-built `window.screenRecorder` methods only. It does not expose
  `ipcRenderer`, filesystem access, shell access, or arbitrary channel access.
- Commands use one fixed IPC channel and are validated against versioned Zod schemas before any
  application use case runs.
- Responses and events are validated at the preload boundary. Events include a protocol version and
  event identifier so subscriptions can evolve without accepting ambiguous payloads.
- IPC requests are accepted only from the active main window's `webContents`.
- Navigation is restricted to the packaged renderer directory or the Vite development origin.
  New-window requests and webviews are denied.
- The renderer has a restrictive Content Security Policy: scripts and connections are self-scoped,
  objects are disabled, framing is disabled, and form submission is disabled.

Raw video frames, audio samples, and media buffers are not part of the IPC contract. Native capture
and encoding will remain outside JavaScript in the later Swift integration phases.
