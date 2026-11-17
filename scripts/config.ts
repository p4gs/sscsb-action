/**
 * A vendored slice of the directory site's own constants, so a record this
 * action builds is stamped with the same methodology version the site scores
 * against. `METHODOLOGY_VERSION` is the only export anything here imports.
 *
 * The path/name constants below are LEFTOVERS of that copy and are dead in
 * this repo. They also no longer describe the live site, which serves at the
 * ROOT of sscsb.dev — it moved off `tools.sensiblesecurity.xyz/sscs-bootstrapper/`,
 * then off `/sscsb/`. They are left in place rather than corrected because a
 * dead constant with an invented value is worse than one that is visibly
 * historical; deleting them is its own change.
 */
export const BASE_PATH = "/sscs-bootstrapper/";

export const SITE_NAME = "SSCS Bootstrapper";
export const REPO_URL = "https://github.com/p4gs/sscs-bootstrapper";
export const SUBMIT_URL = `${REPO_URL}/issues/new?template=scan-request.yml`;

/** Bumped when the scoring rules change; displayed on every repo page. */
export const METHODOLOGY_VERSION = 2;

/** The scan-record schema this site build understands. */
export const SCHEMA_VERSION = 1;
