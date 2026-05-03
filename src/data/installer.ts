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
import { CDN_BASE, DATA_DIR, manifestUrl, localPath } from "./paths.js";

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

async function downloadArtifact(a: ManifestArtifact): Promise<void> {
  const dest = localPath(a.name);
  if (existsSync(dest) && statSync(dest).size === a.size) {
    const hash = await sha256OfFile(dest);
    if (hash === a.sha256) {
      console.error(`[mdm-data] cached ${a.name}`);
      return;
    }
    console.error(`[mdm-data] hash mismatch on ${a.name}, re-downloading`);
    unlinkSync(dest);
  }
  ensureDir(dirname(dest));

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

  // Stream gunzip directly to the destination so we never hold the
  // decompressed file in memory.
  const out = createWriteStream(dest);
  const body = res.body as unknown as NodeJS.ReadableStream;
  if (useCompressed) {
    await pipeline(body, createGunzip(), out);
  } else {
    await pipeline(body, out);
  }

  // Verify decompressed-file hash. The compressed-bytes hash isn't checked
  // because verifying the decompressed result is strictly stronger — gzip
  // failures or truncation would be caught here too.
  const got = await sha256OfFile(dest);
  if (got !== a.sha256) {
    unlinkSync(dest);
    throw new Error(
      `sha256 mismatch on ${a.name}: expected ${a.sha256}, got ${got}`
    );
  }
}

let installPromise: Promise<void> | null = null;

/**
 * Download every artifact in the manifest if it isn't already cached locally.
 * Cached artifacts are SHA-verified before being trusted.
 */
export function ensureDataInstalled(): Promise<void> {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    ensureDir(DATA_DIR);
    const manifest = await fetchManifest();
    console.error(
      `[mdm-data] ${manifest.artifacts.length} artifacts, cdn=${manifest.cdnBase}`
    );
    for (const a of manifest.artifacts) {
      try {
        await downloadArtifact(a);
      } catch (err) {
        console.error(`[mdm-data] ${a.name} failed:`, err);
        throw err;
      }
    }
  })();
  return installPromise;
}

export function isDataInstalled(name: string): boolean {
  return existsSync(localPath(name));
}

export { CDN_BASE, DATA_DIR };
