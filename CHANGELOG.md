# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

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
