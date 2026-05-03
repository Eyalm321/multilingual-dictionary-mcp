/**
 * Vitest global setup. Runs BEFORE any module is imported, so the env vars
 * are seen by paths.ts at module load time.
 *
 * Goal: keep tests hermetic. They must never actually hit the live CDN or
 * read cached data from a developer's previous local install.
 */
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

// Bogus CDN URL — every fetch should fail fast with a connection error.
process.env.MDM_CDN_BASE =
  process.env.MDM_CDN_BASE ?? "http://127.0.0.1:1";

// Per-run temp dir so we don't see cached artifacts from earlier installs.
process.env.MDM_DATA_DIR =
  process.env.MDM_DATA_DIR ??
  mkdtempSync(join(tmpdir(), "mdm-test-"));
