import {
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  createReadStream,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import {
  CDN_BASE,
  DATA_DIR,
  manifestUrl,
  localPath,
} from "./paths.js";

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

const status: InstallStatus = {
  state: "pending",
  dataDir: DATA_DIR,
  cdnBase: CDN_BASE,
  totalArtifacts: 0,
  readyArtifacts: 0,
  totalBytesOnWire: 0,
  bytesDownloaded: 0,
  artifacts: [],
};

export function getInstallStatus(): InstallStatus {
  // Return a deep clone so callers can't mutate internal state.
  return JSON.parse(JSON.stringify(status));
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(manifestUrl(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch manifest: ${res.status}`);
  }
  return (await res.json()) as Manifest;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function downloadArtifact(
  a: ManifestArtifact,
  art: ArtifactStatus
): Promise<void> {
  const dest = localPath(a.name);

  // Already cached + verified?
  if (existsSync(dest) && statSync(dest).size === a.size) {
    art.state = "verifying";
    const hash = await sha256OfFile(dest);
    if (hash === a.sha256) {
      art.state = "ready";
      art.bytesDownloaded = art.compressedSize ?? art.size;
      console.error(`[mdm-data] cached ${a.name}`);
      return;
    }
    console.error(`[mdm-data] hash mismatch on ${a.name}, re-downloading`);
    unlinkSync(dest);
  }
  ensureDir(dirname(dest));

  art.state = "downloading";
  art.bytesDownloaded = 0;
  const useCompressed = !!a.compressedUrl;
  const url = useCompressed ? a.compressedUrl! : a.url;
  const wireSize = useCompressed ? a.compressedSize! : a.size;
  console.error(
    `[mdm-data] downloading ${a.name} (${(wireSize / 1_000_000).toFixed(1)} MB on wire${useCompressed ? `, ${(a.size / 1_000_000).toFixed(1)} MB on disk` : ""})`
  );

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} for ${url}`);
  }

  // Track per-chunk progress so dictionary_status reflects live download state.
  const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
  const out = createWriteStream(dest, { flags: "w" });
  // Insert gunzip if the wire format is compressed.
  if (useCompressed) {
    const gunzip = createGunzip();
    gunzip.pipe(out);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      gunzip.write(value);
      art.bytesDownloaded! += value.byteLength;
      status.bytesDownloaded += value.byteLength;
    }
    gunzip.end();
    await new Promise<void>((res, rej) => {
      out.on("close", () => res());
      out.on("error", rej);
    });
  } else {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out.write(value);
      art.bytesDownloaded! += value.byteLength;
      status.bytesDownloaded += value.byteLength;
    }
    out.end();
    await new Promise<void>((res, rej) => {
      out.on("close", () => res());
      out.on("error", rej);
    });
  }

  art.state = "verifying";
  const got = await sha256OfFile(dest);
  if (got !== a.sha256) {
    art.state = "failed";
    art.error = `sha256 mismatch: expected ${a.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…`;
    unlinkSync(dest);
    throw new Error(`sha256 mismatch on ${a.name}`);
  }
  art.state = "ready";
}

let installPromise: Promise<void> | null = null;

/**
 * Begin downloading every artifact in the manifest if not already cached.
 * Non-blocking: returns a promise but the caller is free to ignore it.
 * Progress is observable via getInstallStatus().
 */
export function ensureDataInstalled(): Promise<void> {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    status.startedAt = new Date().toISOString();
    status.state = "downloading";
    try {
      ensureDir(DATA_DIR);
      const manifest = await fetchManifest();
      status.manifestVersion = manifest.version;
      status.cdnBase = manifest.cdnBase;
      status.totalArtifacts = manifest.artifacts.length;
      status.totalBytesOnWire = manifest.artifacts.reduce(
        (s, a) => s + (a.compressedSize ?? a.size),
        0
      );
      status.artifacts = manifest.artifacts.map((a) => ({
        name: a.name,
        size: a.size,
        compressedSize: a.compressedSize,
        state: "queued",
      }));
      console.error(
        `[mdm-data] ${manifest.artifacts.length} artifacts, cdn=${manifest.cdnBase}`
      );
      for (let i = 0; i < manifest.artifacts.length; i += 1) {
        const a = manifest.artifacts[i];
        const art = status.artifacts[i];
        try {
          await downloadArtifact(a, art);
          status.readyArtifacts += 1;
        } catch (err) {
          art.state = "failed";
          art.error = err instanceof Error ? err.message : String(err);
          throw err;
        }
      }
      status.state = "ready";
      status.completedAt = new Date().toISOString();
      console.error("[mdm-data] all artifacts ready");
    } catch (err) {
      status.state = "failed";
      status.error = err instanceof Error ? err.message : String(err);
      console.error("[mdm-data] install failed:", err);
      throw err;
    }
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
