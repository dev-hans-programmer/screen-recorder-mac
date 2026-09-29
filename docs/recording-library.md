# Recording Library

## Storage model

Completed media remains in the configured recordings folder. The app stores only versioned metadata
in `library/recordings.sqlite3` under Electron's per-user application-data directory. Schema version
1 includes the media path, title, duration, dimensions, frame rate, codec, audio flags, creation
time, file size, availability, and optional failure and recovery history.

SQLite runs in WAL mode with full synchronization. Writes use immediate transactions. On startup,
the repository runs an integrity check; an unreadable database is renamed with a `corrupt-<time>`
suffix and replaced with an empty catalog instead of preventing the app from opening.

## Thumbnails

The renderer requests thumbnails only for visible cards. Electron's native thumbnail API generates a
640 × 360 image in the main process without sending video frames through IPC or loading an entire
recording into React. PNG results are cached under `library/thumbnails` and invalidated by recording
identity, creation time, and file size.

## Library actions

- Open launches the recording with the current macOS default application.
- Rename changes both the media filename and its metadata title. Existing filenames are never
  overwritten.
- Reveal selects the media file in Finder.
- Delete requires confirmation and uses macOS Trash rather than permanent deletion.
- If a file was moved outside the app, it is marked missing and can be removed from metadata without
  attempting to delete a path that no longer exists.

Search and sorting run on metadata in the renderer. Grid/list layout and lazy thumbnail loading keep
library interaction responsive as the catalog grows.
