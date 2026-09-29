# ADR-0003: Use Electron Forge for Packaging and CI Artifacts

- Status: Accepted
- Date: 2026-09-30

## Context

The project needs repeatable local and CI builds that produce downloadable macOS artifacts. The initial workflow must not depend on Apple Developer credentials, while leaving room for optional signing and notarization later.

## Decision

Use Electron Forge for development packaging and artifact generation. The default CI path will build the application and publish `.app`, `.dmg`, `.zip`, checksums, and diagnostic logs as downloadable artifacts. Signing and notarization will be optional configuration controlled by CI secrets.

## Packaging requirements

- The Swift helper is packaged outside the ASAR archive.
- Development and packaged helper paths are tested separately.
- The artifact build runs on macOS CI runners.
- The app and helper architecture must match the requested artifact architecture.
- CI must fail clearly on build, test, or packaging errors.
- CI must still publish unsigned test artifacts when signing secrets are absent.

## Consequences

Positive:

- One documented packaging workflow for local and CI builds.
- Downloadable artifacts can be tested before production signing is configured.
- Optional signing can be added without changing the application architecture.

Negative:

- macOS artifact generation requires macOS build infrastructure.
- Unsigned downloads may show Gatekeeper warnings during local testing.
- Native helper packaging must be explicitly verified.
