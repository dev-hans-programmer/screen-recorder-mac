# Preferences and permissions

## Persistent preferences

The Electron main process owns preferences. The renderer can only read or update them through the
typed IPC API; it never accesses the filesystem directly.

Preferences are stored in `preferences.json` under Electron's per-user `userData` directory. The
file contains a schema version and the complete preference snapshot. Updates are written to a
private temporary file, flushed, and atomically renamed so an interrupted write cannot leave a
partially written settings file. Invalid files are quarantined with a `.corrupt-<timestamp>` suffix
and safe defaults are restored.

The persisted snapshot includes:

- Output directory.
- Default profile, resolution, and frame rate.
- System-audio and microphone defaults.
- Global shortcuts.
- System, light, or dark theme.
- First-run onboarding completion.

## First-run onboarding

Onboarding explains why Screen Recording is required and why microphone access is optional. It
shows the current macOS authorization state and provides direct actions to request access, open the
appropriate System Settings privacy pane, or restart the app when ScreenCaptureKit requires it.

The user can continue once Screen Recording is ready or defer setup. Completion is persisted, so
onboarding appears only on a fresh profile.

## Recovery behavior

Permission state is refreshed when the app regains focus, becomes visible, and every five seconds
while visible. The recorder responds as follows:

| Condition                                    | Recovery action                                                |
| -------------------------------------------- | -------------------------------------------------------------- |
| Screen Recording not requested               | Request the macOS permission                                   |
| Screen Recording denied or restricted        | Open the Screen Recording privacy pane                         |
| Microphone denied while selected             | Open the Microphone privacy pane or disable microphone capture |
| Screen access granted after helper launch    | Restart the app and native helper                              |
| Permission revoked while the app is open     | Show an error and link back to System Settings                 |
| Selected display, window, or app disappeared | Refresh capture sources and select an available source         |

Recording is blocked in both TypeScript and Swift while a required permission restart is pending.
The restart action shuts down capture resources before relaunching the Electron app.
