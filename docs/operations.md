# Operations guide

This is the entry point for running, releasing, and supporting Screen Recorder.

| Need                         | Guide                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| Set up and run source        | [Development setup](development.md)                           |
| Build installable artifacts  | [Packaging](packaging.md)                                     |
| Install a downloaded build   | [Installation](installation.md)                               |
| Run CI and publish artifacts | [CI/CD](ci-cd.md)                                             |
| Bump versions/migrate data   | [Versioning and migrations](versioning-and-migrations.md)     |
| Approve a release candidate  | [Release checklist](release-checklist.md)                     |
| Recover permissions          | [Preferences and permissions](preferences-and-permissions.md) |
| Diagnose common failures     | [Troubleshooting](troubleshooting.md)                         |
| Debug CaptureService         | [Native-service debugging](native-service-debugging.md)       |
| Inspect support data         | [Diagnostics](diagnostics.md)                                 |
| Validate performance         | [Performance](performance.md)                                 |
| Understand product limits    | [Known limitations](known-limitations.md)                     |

For a new developer: complete Development setup, run `pnpm release:check`, run the app with
`pnpm dev`, build with `pnpm make`, and execute the release checklist. Failures should first be
classified as UI/IPC, native protocol, permission, capture/encoder, filesystem, or packaging issues.
