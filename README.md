# sscsb-action — SSCS Bootstrapper Scan

Run [`sscsb`](https://github.com/p4gs/sscs-bootstrapper) — the SSCS
Bootstrapper supply-chain-security CLI — inside your repository's **own CI**,
and produce an authenticated scan record for the public directory at
[tools.sensiblesecurity.xyz/sscsb/](https://tools.sensiblesecurity.xyz/sscsb/).

The action installs a Sigstore-verified `sscsb` release, runs the exact scan
protocol the directory uses (pre-init snapshot → `init` → `verify` → `report`
→ fresh-init defaults), builds a schema-v1 `scan-record.json` with the same
vendored scoring code the directory publishes on its
[methodology page](https://tools.sensiblesecurity.xyz/sscsb/methodology/),
keyless-signs it under your workflow's own OIDC identity, and uploads record +
signature bundle as a workflow artifact. Optionally, it files a submission
issue so the directory can pick the record up through its maintainer publish
gate.

## Authenticated vs. external scans

The directory runs two scan lanes:

- **External scans** — the directory's own pipeline clones a public repository
  and scans it unauthenticated. GitHub-side checks (branch protection
  rulesets, Scorecard) see only what an anonymous caller sees, so some
  controls can come back `unverified` purely for lack of API visibility.
- **Authenticated scans (this action)** — the scan runs inside the
  repository's own workflow with its own `GITHUB_TOKEN`, so GitHub-side
  checks see the repository the way its owners do. Records from this lane are
  marked as action scans in the directory.

Both lanes produce the same record shape, are scored by the same methodology,
and pass through the same maintainer gate before anything is published.

## Quickstart

```yaml
# .github/workflows/sscsb-scan.yml
name: SSCS Bootstrapper Scan
on:
  push:
    branches: [main]
  schedule:
    - cron: "17 6 * * 1" # weekly

permissions:
  contents: read

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # keyless-sign the record — the identity the directory verifies
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
          fetch-depth: 0 # full history improves history-based checks
      - uses: p4gs/sscsb-action@v1
        with:
          submit: "false"
```

The scan needs no secrets. `contents: read` is enough to *scan*; `id-token:
write` (no secret involved — it is GitHub's own short-lived OIDC token) is what
lets the record be **signed**. Without it the action still runs and warns, but
the directory lists the unsigned record only as an unverified claim. Keep the
workflow at `.github/workflows/sscsb-scan.yml` on your default branch: the
directory pins verification to exactly that path (see
[Signed records](#signed-records)).

## Inputs

| Input | Default | Description |
|---|---|---|
| `sscsb-version` | `latest` | Release tag of `p4gs/sscs-bootstrapper` to install (e.g. `v0.3.0`). `latest` resolves the newest release; `build` compiles from a shallow clone of `main` with `cargo build --release --locked`. If a release has no asset for the runner's platform, the action falls back to the cargo build. Release assets are verified against their `.sha256` sidecars; a mismatch fails the run — it never silently falls back. |
| `submit` | `false` | When `true`, file or refresh a scan-submission issue on the directory repository (see [Submitting to the directory](#submitting-to-the-directory) — this needs a non-default token). |
| `directory-repo` | `p4gs/p4gs.github.io` | The directory repository that receives submission issues. |
| `github-token` | `${{ github.token }}` | Token for GitHub API reads during the scan and for the submit lane. The default token covers everything **except** cross-repo submission. |
| `sign` | `auto` | Keyless-sign `scan-record.json` under the workflow's OIDC identity. `auto` signs when the job has `id-token: write` and otherwise warns and uploads unsigned; `true` fails the step when signing is impossible; `false` never signs. |

## Outputs

| Output | Description |
|---|---|
| `grade` | Directory letter grade: `A+`, `A`, `B`, `C`, `D`, `F`, or `NA` (insufficient evidence). |
| `overall-percent` | Overall score percentage (one decimal), or empty when no countable evidence exists. |
| `record-path` | Absolute path to the generated `scan-record.json`. |
| `signed` | `true` when the record was keyless-signed, else `false`. |
| `bundle-path` | Absolute path to the Sigstore bundle (`scan-record.json.sigstore.json`), empty when unsigned. |

The record — and its signature bundle when signed — is also uploaded as the
workflow artifact **`sscsb-scan-record`**.

## How the record reaches the directory

1. The action uploads `scan-record.json` as the `sscsb-scan-record` artifact
   on your (public) workflow run.
2. With `submit: "true"`, it files — or refreshes, matching on the exact
   title — an issue on the directory repository titled
   `[action-scan] OWNER/REPO`, labeled `action-scan-result`, containing the
   repo slug, run ID, run URL, artifact name, and head SHA. The record JSON
   itself is **never** placed in the issue body.
3. The directory's pipeline fetches the artifact from that public run,
   re-validates it, and routes it through the same **maintainer publish
   gate** every scan goes through. Nothing appears in the directory without a
   maintainer approving it.

### Submitting to the directory

Be aware of what the default token can and cannot do: **`${{ github.token }}`
cannot create issues on another repository.** The submit lane files an issue
on `directory-repo`, which is a different repo from yours, so `submit: "true"`
requires one of:

- a **fine-grained PAT** or **GitHub App installation token** with
  `issues: write` on the directory repository, passed as `github-token`, or
- leaving `submit: "false"` and filing the submission issue yourself — open an
  issue on the directory repo with your workflow run URL and the artifact name
  `sscsb-scan-record`.

If you pass a custom token, scope it to exactly `issues: write` on the
directory repo; the scan itself never needs it.

```yaml
      - uses: p4gs/sscsb-action@v1
        with:
          submit: "true"
          github-token: ${{ secrets.SSCSB_DIRECTORY_TOKEN }}
```

## Signed records

This is the [OpenSSF Scorecard](https://github.com/ossf/scorecard-action) trust
model, applied to sscsb records. A record produced in your own CI is the only
kind that can see repository settings — which is exactly why the directory
must be able to prove that *your* CI produced it:

1. With `id-token: write`, the action runs `cosign sign-blob` on the record.
   Fulcio issues a short-lived certificate whose identity **is your
   workflow** — repository, workflow path, and branch ref, burned in by
   GitHub's OIDC issuer rather than asserted by the record — and the
   signature is logged to Rekor's public transparency log.
2. The bundle ships next to the record in the `sscsb-scan-record` artifact.
3. The directory's ingest runs `cosign verify-blob` pinned to
   `https://github.com/OWNER/REPO/.github/workflows/sscsb-scan.yml@refs/heads/<default branch>`
   — with the default branch read **live** from GitHub, never from the
   record — and to the commit the record claims. A third party cannot mint
   that identity; a feature-branch or renamed-workflow signature does not
   verify; a record whose bundle fails verification is rejected outright.

What this does *not* prove (stated so nobody mistakes it for more): that the
workflow which signed the record was unmodified. A maintainer who edits their
own `sscsb-scan.yml` can sign whatever it emits. OpenSSF Scorecard closes that
gap by fetching the producing workflow at the certificate's commit and
rule-checking it; that is the directory's ingestion-hardening milestone, and
until then the human publish gate is the backstop.

Signing writes to a public transparency log. If that is not acceptable for a
repository, set `sign: "false"`; the record still uploads, and the directory
lists it as an unverified claim.

## Security posture

What this action does:

- Downloads an `sscsb` release tarball and verifies it **twice** before
  extracting: against its `.sha256` sidecar (integrity) and against its
  Sigstore bundle, pinned to the tool repository's own release workflow at
  that exact tag — `sscs-bootstrapper/.github/workflows/release.yml@refs/tags/<version>`
  — via GitHub's OIDC issuer (origin). Either check failing fails the run; a
  missing bundle is a tamper signal, never a reason to fall back to another
  install path. (`sscsb-version: build` compiles from source instead and is
  not Sigstore-verified — it exists for pre-release testing.)
- Runs `git` commands and `sscsb` against your working tree. `sscsb init`
  writes its scan scaffolding (`.sscsb/`, config templates) into the
  ephemeral workspace — the action never commits, never pushes, and never
  modifies anything outside the runner.
- Reads your repository's metadata (default branch, description) via the
  GitHub API with the token you provide.
- Treats `sscsb verify` exit `1` ("a gate failed") as scan **data**; exit `2`
  (operational error) fails the action. An unperformed check is recorded as
  `unverified`, never as a pass.

What it never does:

- **Never executes your repository's code** — no dependency install, no build,
  no test run. Only `git` and `sscsb` touch the tree.
- **Never requires secrets** for the scan lane; the default `GITHUB_TOKEN`
  with `contents: read` is sufficient to scan, and `id-token: write` (GitHub's
  own short-lived OIDC token, not a secret) is all that signing needs.
- **Never uploads your code anywhere.** The only things that leave the runner
  are the `scan-record.json` artifact (plus its signature bundle) on your own
  run, the Rekor transparency-log entry for that signature when signing is
  on, and, if you opt in, the submission issue's metadata (slug, run ID/URL,
  SHA, artifact name, signed yes/no).
- Never interpolates untrusted strings into shell — inputs and
  repo-influenced values reach scripts via environment variables only, and
  every third-party action is SHA-pinned.

### Evidence honesty

`sscsb init` installs some of the very artifacts `sscsb verify` checks for. A
naive scan would credit the scanner's own output to your repository. The
action therefore snapshots `git ls-files` **before** running `init`; the
record builder refuses to count anything created after that snapshot as your
evidence, and controls that can only be observed in a local development
environment are recorded as `unverified` rather than passed. Full rules on the
[methodology page](https://tools.sensiblesecurity.xyz/sscsb/methodology/).

Tip: `sscsb` orchestrates external scanners (TruffleHog, Gitleaks, Syft,
Trivy, OSV-Scanner, …). Tools missing on the runner degrade the affected
checks, which lowers *evidence coverage*, not your pass rate — installing them
in a step before this action raises how much of your posture the record can
actually attest.

## Version compatibility

The protocol requires `sscsb verify --format json`, which landed **after**
sscsb v0.2.1. The action probes the installed binary and fails with a clear
message if it is too old; until a newer release is published, use
`sscsb-version: "build"`.

## Vendored scoring code

`scripts/` contains verbatim copies of the directory site's record pipeline
(`schema.ts`, `reclassify.ts`, `scoring.ts`, `config.ts`,
`scan/build-record.ts`). The canonical source of these files is the directory
site's repository; the copies here are kept in sync by release discipline —
a methodology change there is a new tagged release here. The record embeds
both `schema_version` and `methodology_version`, so the directory rejects
records built by a stale pipeline instead of mis-scoring them.

## License

Apache-2.0 — see [LICENSE](LICENSE).
