# Release-candidate checklist

Use this checklist for every release candidate on a clean supported Mac. Record the macOS version,
hardware, candidate version, commit SHA, artifact SHA-256, tester, date, and result in the release
issue. A candidate is not approved while any required item is unchecked.

## Automated gates

- [ ] `pnpm install --frozen-lockfile` succeeds with the pinned Node and pnpm versions.
- [ ] `pnpm release:check` passes.
- [ ] `pnpm make` creates Universal 2 DMG, ZIP, and `SHA256SUMS` artifacts.
- [ ] `pnpm artifacts:verify` and `node scripts/verify-package.mjs` pass.
- [ ] `pnpm test:packaged:probe` launches the packaged app and reaches the native helper.
- [ ] Build metadata reports the intended app, Electron, React, Swift toolchain, and helper versions.

## Clean install and first run

- [ ] Download the CI artifact on a Mac that has never run this bundle identifier.
- [ ] Verify SHA-256, install from DMG, and use the documented Gatekeeper flow.
- [ ] Confirm the app name, icon, version, navigation, and native-bridge-online status.
- [ ] Complete Screen Recording onboarding and optional microphone onboarding.
- [ ] Restart when requested; refresh sources and confirm displays/windows/apps appear.

## Recording and recovery

- [ ] Record 30 seconds at Source/60 FPS with system audio; confirm timer and byte count advance.
- [ ] Record with microphone enabled and verify both audio tracks during playback.
- [ ] Pause/resume, stop, play, reveal, rename, edit/export, and move a recording to Trash.
- [ ] Force-quit during a recording, relaunch, and verify interrupted-recording recovery is offered.
- [ ] Revoke Screen Recording access and verify capture is blocked with an actionable recovery link.

## Upgrade and data preservation

- [ ] Install the previous release, change every setting, and create/rename at least two recordings.
- [ ] Replace the app with the candidate without deleting `userData` or recording files.
- [ ] Confirm settings, shortcuts, output directory, library metadata, thumbnails, and media remain.
- [ ] Export support diagnostics and confirm application/native versions match the candidate.

## Artifact launch

- [ ] Launch the DMG-installed app.
- [ ] Launch the ZIP-installed app after moving it to Applications.
- [ ] Confirm both artifacts are Universal 2 and pass `codesign --verify --deep --strict`.
- [ ] Attach the completed checklist/evidence to the GitHub release and retain failed logs.
