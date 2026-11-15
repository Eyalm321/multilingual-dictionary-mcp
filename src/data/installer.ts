import {
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  createReadStream,
  unlinkSync,
  writeFileSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { CDN_BASE, DATA_DIR, localPath } from "./paths.js";
import { DATA_BUNDLE_VERSION, PINNED_ARTIFACTS, type Pins } from "./pinned.js";

interface ManifestArtifact {
  name: string;
  url: string;
  size: number;
  sha256: string;
  compressedUrl?: string;
  compressedSize?: number;
  compressedSha256?: string;
}

interface Manifest {
  version: number;
  builtAt: string;
  cdnBase: string;
  artifacts: ManifestArtifact[];
}

export type InstallState = "pending" | "downloading" | "ready" | "failed";

export interface ArtifactStatus {
  name: string;
  size: number;
  compressedSize?: number;
  state: "queued" | "downloading" | "verifying" | "ready" | "failed";
  bytesDownloaded?: number;
  error?: string;
}

export interface InstallStatus {
  state: InstallState;
  dataDir: string;
  cdnBase: string;
  manifestVersion?: number;
  startedAt?: string;
  completedAt?: string;
  totalArtifacts: number;
  readyArtifacts: number;
  totalBytesOnWire: number;
  bytesDownloaded: number;
  artifacts: ArtifactStatus[];
  error?: string;
}

export interface InstallOptions {
  cdnBase: string;
  dataDir: string;
  /** Expected artifacts; anything else is refused. Defaults to the pinned bundle. */
  pins: Pins;
}

export function newStatus(opts: Pick<InstallOptions, "cdnBase" | "dataDir">): InstallStatus {
  return {
    state: "pending",
    dataDir: opts.dataDir,
    cdnBase: opts.cdnBase,
    totalArtifacts: 0,
    readyArtifacts: 0,
    totalBytesOnWire: 0,
    bytesDownloaded: 0,
    artifacts: [],
  };
}

const status: InstallStatus = newStatus({ cdnBase: CDN_BASE, dataDir: DATA_DIR });

export function getInstallStatus(): InstallStatus {
  // Return a deep clone so callers can't mutate internal state.
  return JSON.parse(JSON.stringify(status));
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

const BUILD_HINT =
  'Cached data is kept. Point MDM_CDN_BASE at a mirror that serves the same bundle, or see "Building the data bundle yourself" in the README.';

function causeOf(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  return e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(err);
}

async function fetchManifest(cdnBase: string): Promise<unknown> {
  const url = `${cdnBase}/manifest.json`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new Error(`data host unreachable: ${url} (${causeOf(err)}). ${BUILD_HINT}`);
  }
  if (!res.ok) {
    throw new Error(`data manifest unavailable: ${url} returned HTTP ${res.status}. ${BUILD_HINT}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`data manifest at ${url} is not valid JSON. ${BUILD_HINT}`);
  }
}

/**
 * Accept a manifest only if it lists exactly the pinned artifacts with the pinned sha256 and
 * size. The data host is not trusted: its manifest can't introduce, drop or change an artifact.
 */
export function validateManifest(raw: unknown, pins: Pins): Manifest {
  const m = raw as Partial<Manifest> | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.artifacts)) {
    throw new Error("manifest refused: malformed");
  }
  const names = m.artifacts.map((a) => a?.name);
  const pinned = Object.keys(pins);
  const unknown = names.filter((n) => !Object.prototype.hasOwnProperty.call(pins, n));
  const missing = pinned.filter((n) => !names.includes(n));
  if (unknown.length || missing.length || names.length !== pinned.length) {
    throw new Error(
      `manifest refused: artifact list does not match the pinned bundle (unexpected: ${unknown.join(", ") || "none"}; missing: ${missing.join(", ") || "none"})`
    );
  }
  for (const a of m.artifacts) {
    const pin = pins[a.name];
    if (a.sha256 !== pin.sha256 || a.size !== pin.size) {
      throw new Error(`manifest refused: ${a.name} does not match its pinned sha256/size`);
    }
  }
  return m as Manifest;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * Marker file path — written next to the artifact when SHA-256 verification
 * passes. Subsequent launches trust the cache when this marker exists, the
 * file size matches, and mtime hasn't moved. Avoids re-hashing 7 GB of
 * wiktextract-all.sqlite on every server start.
 */
function markerPath(artifactPath: string): string {
  return `${artifactPath}.verified`;
}

interface CacheMarker {
  sha256: string;
  size: number;
  mtimeMs: number;
}

function readMarker(path: string): CacheMarker | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CacheMarker;
  } catch {
    return null;
  }
}

function writeMarker(artifactPath: string, sha256: string): void {
  const st = statSync(artifactPath);
  const m: CacheMarker = { sha256, size: st.size, mtimeMs: st.mtimeMs };
  writeFileSync(markerPath(artifactPath), JSON.stringify(m));
}

/** Cached file matches its pin according to the verified marker (no hashing). */
function markerMatchesPin(dest: string, pin: { sha256: string; size: number }): boolean {
  if (!existsSync(dest)) return false;
  const marker = readMarker(markerPath(dest));
  const st = statSync(dest);
  return (
    !!marker &&
    marker.sha256 === pin.sha256 &&
    marker.size === pin.size &&
    st.size === pin.size &&
    st.mtimeMs === marker.mtimeMs
  );
}

/**
 * Is the local copy of this artifact the pinned one? Fast path: verified marker. Slow path
 * (no or stale marker, size matches): hash once and write the marker. A file that doesn't match
 * is left in place here; only a verified download replaces it.
 */
async function cachedMatchesPin(
  dest: string,
  pin: { sha256: string; size: number },
  art: ArtifactStatus
): Promise<boolean> {
  if (markerMatchesPin(dest, pin)) return true;
  if (existsSync(dest) && statSync(dest).size === pin.size) {
    art.state = "verifying";
    if ((await sha256OfFile(dest)) === pin.sha256) {
      writeMarker(dest, pin.sha256);
      return true;
    }
  }
  return false;
}

async function downloadArtifact(
  a: ManifestArtifact,
  pin: { sha256: string; size: number },
  art: ArtifactStatus,
  opts: InstallOptions,
  st: InstallStatus
): Promise<void> {
  const dest = resolve(opts.dataDir, a.name);
  // URLs come from our own base, never from the manifest, so a manifest can't send us elsewhere.
  const useCompressed = !!a.compressedUrl;
  const url = `${opts.cdnBase}/${a.name}${useCompressed ? ".gz" : ""}`;
  const wireSize = useCompressed ? a.compressedSize ?? pin.size : pin.size;
  console.error(
    `[mdm-data] downloading ${a.name} (${(wireSize / 1_000_000).toFixed(1)} MB on wire${useCompressed ? `, ${(pin.size / 1_000_000).toFixed(1)} MB on disk` : ""})`
  );

  art.state = "downloading";
  art.bytesDownloaded = 0;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`data host unreachable: ${url} (${causeOf(err)}). ${BUILD_HINT}`);
  }
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} for ${url}. ${BUILD_HINT}`);
  }

  // Write to a side file; the cached copy (if any) is only replaced once the download verifies.
  const partial = `${dest}.partial`;
  const counter = async function* (src: AsyncIterable<Uint8Array>) {
    for await (const chunk of src) {
      art.bytesDownloaded! += chunk.byteLength;
      st.bytesDownloaded += chunk.byteLength;
      yield chunk;
    }
  };
  const body = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  try {
    if (useCompressed) {
      await pipeline(body, counter, createGunzip(), createWriteStream(partial));
    } else {
      await pipeline(body, counter, createWriteStream(partial));
    }
    art.state = "verifying";
    const got = await sha256OfFile(partial);
    if (got !== pin.sha256 || statSync(partial).size !== pin.size) {
      art.error = `sha256 mismatch: expected ${pin.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…`;
      throw new Error(`refused ${a.name} from ${url}: does not match its pinned sha256/size. ${BUILD_HINT}`);
    }
    renameSync(partial, dest);
  } finally {
    if (existsSync(partial)) unlinkSync(partial);
  }
  writeMarker(dest, pin.sha256);
  art.state = "ready";
}

/**
 * Bring the data dir to the pinned bundle. A fully cached bundle needs no network at all;
 * otherwise the manifest must match the pins and every download must verify against its pin.
 * Throws (and leaves the cache untouched) when the host is unreachable or serves anything else.
 */
export async function installWith(opts: InstallOptions, st: InstallStatus): Promise<void> {
  st.startedAt = new Date().toISOString();
  st.state = "downloading";
  st.cdnBase = opts.cdnBase;
  st.dataDir = opts.dataDir;
  const names = Object.keys(opts.pins);
  st.totalArtifacts = names.length;
  st.readyArtifacts = 0;
  st.bytesDownloaded = 0;
  st.totalBytesOnWire = names.reduce((s, n) => s + opts.pins[n].size, 0);
  st.artifacts = names.map((n) => ({ name: n, size: opts.pins[n].size, state: "queued" }));
  try {
    ensureDir(opts.dataDir);
    const missing: string[] = [];
    for (let i = 0; i < names.length; i += 1) {
      const art = st.artifacts[i];
      if (await cachedMatchesPin(resolve(opts.dataDir, names[i]), opts.pins[names[i]], art)) {
        art.state = "ready";
        art.bytesDownloaded = art.size;
        st.bytesDownloaded += art.size;
        st.readyArtifacts += 1;
        console.error(`[mdm-data] cached ${names[i]} (verified)`);
      } else {
        art.state = "queued";
        missing.push(names[i]);
      }
    }
    if (missing.length > 0) {
      const manifest = validateManifest(await fetchManifest(opts.cdnBase), opts.pins);
      st.manifestVersion = manifest.version;
      console.error(`[mdm-data] ${missing.length} of ${names.length} artifacts to download from ${opts.cdnBase}`);
      for (const name of missing) {
        const a = manifest.artifacts.find((x) => x.name === name)!;
        const art = st.artifacts[names.indexOf(name)];
        art.compressedSize = a.compressedSize;
        try {
          await downloadArtifact(a, opts.pins[name], art, opts, st);
          st.readyArtifacts += 1;
        } catch (err) {
          art.state = "failed";
          art.error = art.error ?? (err instanceof Error ? err.message : String(err));
          throw err;
        }
      }
    } else {
      st.manifestVersion = DATA_BUNDLE_VERSION;
    }
    st.state = "ready";
    st.completedAt = new Date().toISOString();
    console.error("[mdm-data] all artifacts ready");
  } catch (err) {
    st.state = "failed";
    st.error = err instanceof Error ? err.message : String(err);
    console.error(`[mdm-data] install failed: ${st.error}`);
    throw err;
  }
}

let installPromise: Promise<void> | null = null;

const LOCK_FILE_NAME = "install.lock";

/**
 * Try to acquire a process-level lock so multiple server instances don't all
 * race to verify / download the cache. Returns true if this process has the
 * lock; false if another active process owns it. Stale locks (process gone)
 * are taken over.
 */
function tryAcquireInstallLock(): boolean {
  const lockPath = localPath(LOCK_FILE_NAME);
  ensureDir(DATA_DIR);
  if (existsSync(lockPath)) {
    try {
      const pid = parseInt(readFileSync(lockPath, "utf8").trim(), 10);
      // process.kill(pid, 0) throws ESRCH if the process is gone, returns true if alive.
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          // Lock holder is still alive — back off.
          return false;
        } catch {
          // Stale — fall through and overwrite.
        }
      }
    } catch {
      // Unreadable — overwrite.
    }
  }
  writeFileSync(lockPath, String(process.pid));
  // Best-effort cleanup on exit.
  const cleanup = () => {
    try {
      if (existsSync(lockPath)) {
        const cur = readFileSync(lockPath, "utf8").trim();
        if (cur === String(process.pid)) unlinkSync(lockPath);
      }
    } catch {
      /* ignore */
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  return true;
}

/**
 * Begin downloading every pinned artifact that isn't already cached.
 * Non-blocking: returns a promise but the caller is free to ignore it.
 * Progress is observable via getInstallStatus().
 */
export function ensureDataInstalled(): Promise<void> {
  if (installPromise) return installPromise;
  const opts: InstallOptions = { cdnBase: CDN_BASE, dataDir: DATA_DIR, pins: PINNED_ARTIFACTS };
  installPromise = (async () => {
    if (!tryAcquireInstallLock()) {
      // Another active process owns the cache. Report what's on disk (verified markers only,
      // no network, no hashing) and let the lock holder do the work.
      console.error("[mdm-data] another instance is managing the cache; reporting cached state");
      status.startedAt = new Date().toISOString();
      const names = Object.keys(opts.pins);
      status.totalArtifacts = names.length;
      status.totalBytesOnWire = names.reduce((s, n) => s + opts.pins[n].size, 0);
      status.artifacts = names.map((n) => {
        const ready = markerMatchesPin(localPath(n), opts.pins[n]);
        return {
          name: n,
          size: opts.pins[n].size,
          state: ready ? "ready" : "queued",
          bytesDownloaded: ready ? opts.pins[n].size : 0,
        };
      });
      status.readyArtifacts = status.artifacts.filter((a) => a.state === "ready").length;
      status.bytesDownloaded = status.artifacts.reduce((s, a) => s + (a.bytesDownloaded ?? 0), 0);
      status.state = status.readyArtifacts === status.totalArtifacts ? "ready" : "downloading";
      status.completedAt = new Date().toISOString();
      return;
    }
    await installWith(opts, status);
  })();
  return installPromise;
}

export function isDataInstalled(name: string): boolean {
  return existsSync(localPath(name));
}

export function isDataReady(): boolean {
  return status.state === "ready";
}

export function dataInstallSummary(): string {
  if (status.state === "ready") return "ready";
  if (status.state === "failed") return `install failed: ${status.error}`;
  if (status.state === "downloading") {
    const cur = status.artifacts.find((a) => a.state === "downloading");
    const pct =
      status.totalBytesOnWire > 0
        ? ((status.bytesDownloaded / status.totalBytesOnWire) * 100).toFixed(1)
        : "?";
    return `downloading ${status.readyArtifacts}/${status.totalArtifacts} artifacts, ${pct}% bytes overall${cur ? `, current: ${cur.name}` : ""}`;
  }
  return "not started";
}

export { CDN_BASE, DATA_DIR };
