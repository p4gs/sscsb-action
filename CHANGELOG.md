# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **OSV-Scanner is installed on the runner** (pinned v2.4.0, sha256-checked,
  Linux x86_64), so `verify vuln-scan` under sscsb ≥ 0.4 is a verdict rather
  than a presence check: every installed scanner runs and a finding at or
  above `fail_on` is a `fail` in the record. A download that does not match
  its digest, or a binary that does not answer `--version`, fails the step
  outright — a lane that promised the scanner never publishes a record
  without it. Other platforms get a warning and the honest
  `degraded_reason = tool-missing`. Trivy and Syft are deliberately not
  installed: Trivy pulls a vulnerability database per runner, and both stay
  local-lane depth.
- **Three controls classified** ahead of the sscsb release that emits them:
  `binary-artifacts` (class A, phase 1), `webhooks` (class B, phase 1) and
  `dependency-pinning` (class A, phase 2). Classification is fail-closed, so
  this has to land before the scanner does.

### Changed

- **A `degraded` row with pre-existing artifacts is rescored `pass` only when
  the scanner was absent.** sscsb ≥ 0.4 rows carry `degraded_reason`; the
  lift now applies only to `tool-missing` (or to rows from binaries older
  than the field, whose only degrade was an absent tool). `scan-error` and
  `no-inventory` stay `unverified` with the reason quoted — a scanner that
  ran and could not verify must never outrank a maintainer's real `fail`.

- **Sigstore-verified install.** The `sscsb` release tarball is now verified
  against its `.sigstore.json` bundle — pinned to the tool repository's own
  `release.yml@refs/tags/<version>` signing identity via GitHub's OIDC
  issuer — in addition to the `.sha256` sidecar. Integrity *and* origin; a
  missing or non-verifying bundle fails the run rather than falling back.
- **Signed scan records** (`sign` input, default `auto`): with `id-token:
  write` on the job, `scan-record.json` is keyless-signed with cosign under
  the workflow's OIDC identity and the bundle ships in the
  `sscsb-scan-record` artifact. The directory verifies it pinned to
  `OWNER/REPO/.github/workflows/sscsb-scan.yml` on the live default branch —
  the OpenSSF-Scorecard trust model. `auto` warns and uploads unsigned when
  the permission is absent; `true` fails instead; `false` never signs.
- New outputs `signed` and `bundle-path`; the submission issue states whether
  the record is signed.
- `cosign` is installed unconditionally (pinned `sigstore/cosign-installer`).

### Changed

- Quickstart now grants `id-token: write` and documents the canonical
  workflow path the directory pins to (`.github/workflows/sscsb-scan.yml`).
- The self-test workflow installs `latest` (v0.3.0+) instead of building
  from source — so CI exercises the Sigstore-verified install path — and
  signs and verifies its own record end-to-end.

## [0.1.0] - 2026-09-01

### Added

- Initial release of **SSCS Bootstrapper Scan**, a composite GitHub Action
  that runs `sscsb` inside a repository's own CI — the authenticated scan
  lane for the public directory at tools.sensiblesecurity.xyz/sscsb/.
- Checksum-verified install of `sscsb` release tarballs
  (Linux x86_64, macOS arm64/x86_64), with a `cargo build --release --locked`
  fallback from `main` (`sscsb-version: build`, or when no release asset
  matches the runner platform).
- The full directory scan protocol: pre-init `git ls-files` snapshot (the
  honesty diff), `sscsb init`, `verify --format json` (exit 1 treated as scan
  data), `report --format json`, and a fresh-init defaults report from the
  same binary in an empty temp repo.
- Vendored record pipeline (`scripts/` — verbatim copies of the directory
  site's `schema.ts`, `reclassify.ts`, `scoring.ts`, `config.ts`,
  `scan/build-record.ts`) producing a schema-v1 `scan-record.json`.
- Outputs `grade`, `overall-percent`, `record-path`; the record is uploaded
  as the `sscsb-scan-record` workflow artifact.
- Optional submit lane (`submit: "true"`): files or refreshes a
  `[action-scan] OWNER/REPO` issue labeled `action-scan-result` on the
  directory repository, carrying run metadata only — never the record JSON.
- Self-test CI workflow running the action against this repository.

[0.1.0]: https://github.com/p4gs/sscsb-action/releases/tag/v0.1.0
