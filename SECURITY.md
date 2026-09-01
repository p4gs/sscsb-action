# Security Policy

## Reporting a vulnerability

Please report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/p4gs/sscsb-action/security/advisories/new)
— it keeps the report private while it is triaged and fixed, and it credits you
in the advisory when it is published.

Please do **not** open a public issue for a security report, and do not include
proof-of-concept secrets or live credentials in a report.

What to expect:

- **Acknowledgement** within 72 hours.
- **Triage verdict** (accepted / not a vulnerability / needs more info) within 7 days.
- **Fix or mitigation** for accepted reports targeted within 30 days, with a
  published GitHub Security Advisory and a patched release. Coordinated
  disclosure is the default; if a fix needs longer, you'll get a status update
  and a revised timeline rather than silence.

## Scope

`sscsb-action` is a composite GitHub Action that runs authenticated `sscsb`
scans inside a consumer's CI. Reports of particular interest, roughly in order
of blast radius:

- A way for the action to **exfiltrate or log a consumer's credentials** — the
  token it authenticates with, or anything else in the runner environment.
- **Script or expression injection** through action inputs, repository content,
  or scan output interpolated into shell steps or `${{ }}` expressions.
- The vendored TypeScript under `scripts/` **misparsing or misreporting a scan
  record** in a way that upgrades a failing security posture to a passing one.
- The action's own pinned dependencies (downloaded `sscsb` release, pinned
  third-party actions) being resolvable to something other than what the pin
  claims.

## Supported versions

| Version | Supported |
|---------|-----------|
| latest release + `main` | ✔ |
| anything older | ✘ — upgrade first, then re-test |

## Verifying what you run

Releases are **source-only git tags** — this action ships no built artifacts,
so there is nothing to verify with cosign or slsa-verifier. The integrity story
is the git history itself: commits on `main` are signed and verified, and the
strongest way to consume the action is to **pin it by full commit SHA** (the
same convention this repository's own workflows follow):

```yaml
uses: p4gs/sscsb-action@<full-40-hex-commit-sha> # vX.Y.Z
```

The moving `v1` major tag follows the GitHub Actions ecosystem convention and
is inherently mutable — convenient, but a SHA pin is the immutable option.
