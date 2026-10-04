# Versioning and migrations

## Release version

The root `package.json` is the canonical release version. Desktop and workspace package manifests
and `CaptureService` intentionally carry the same version because they are shipped as one product.

Check alignment:

```bash
pnpm version:check
```

Prepare a version bump:

```bash
pnpm version:set 0.1.4
```

The command validates semantic versioning and updates every application/package manifest plus the
Swift helper declaration. Then update `CHANGELOG.md`, run `pnpm release:check`, build artifacts, and
inspect the diff before committing. A release tag must exactly match the committed version with a
`v` prefix.

`app.getVersion()` reads the packaged desktop manifest. The React UI reads that same manifest, and
the helper returns its compiled version during every protocol response. Exported diagnostics show
both expected and observed helper versions. `scripts/verify-package.mjs` rejects an app whose
Info.plist or helper handshake differs from the canonical version.

## Persisted schema policy

Release versions and data schema versions are independent integers:

| Data                                 | Current schema | Storage                                |
| ------------------------------------ | -------------- | -------------------------------------- |
| Preferences envelope                 | 1              | `userData/preferences.json`            |
| Recording catalog and recording rows | 1              | `userData/library/recordings.sqlite3`  |
| Recording performance diagnostics    | 1              | `userData/diagnostics/recordings.json` |

Never edit an already-released migration. To change a schema:

1. Increment its schema constant in the domain package.
2. Append one migration from version `N` to `N + 1`; do not skip integers.
3. Preserve unknown and user-selected fields whenever the target model supports them.
4. Execute the migration atomically before repositories serve data.
5. Add tests that start from the previous schema and verify every user value and recording survives.
6. Document any visible effect in `CHANGELOG.md`.

Preferences are rewritten atomically after migration. SQLite migrations use an immediate
transaction and update `PRAGMA user_version` only in that transaction. Corrupt data is quarantined
instead of silently overwritten. A database from a newer schema is rejected, which prevents an
older build from destroying newer metadata.
