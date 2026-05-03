import { createWriteStream, existsSync, mkdirSync, statSync, createReadStream } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { CDN_BASE, DATA_DIR, manifestUrl, localPath, PROFILE } from "./paths.js";

interface ManifestArtifact {
  name: string;
  url: string;
  size: number;
  sha256: string;
  profile: "small" | "medium" | "full";
}

interface Manifest {
  version: number;
  builtAt: string;
  cdnBase: string;
  artifacts: ManifestArtifact[];
}

const PROFILE_INCLUDES: Record<string, Array<"small" | "medium" | "full">> = {
  online: [],
  small: ["small"],
  medium: ["small", "medium"],
  full: ["small", "medium", "full"],
};

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
  }
  ensureDir(dirname(dest));
  console.error(
    `[mdm-data] downloading ${a.name} (${(a.size / 1_000_000).toFixed(1)} MB)`
  );
  const res = await fetch(a.url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} for ${a.url}`);
  }
  const out = createWriteStream(dest);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, out);
  const got = await sha256OfFile(dest);
  if (got !== a.sha256) {
    throw new Error(`sha256 mismatch on ${a.name}: expected ${a.sha256}, got ${got}`);
  }
}

let installPromise: Promise<void> | null = null;

/**
 * Download artifacts for the configured profile if they aren't already present.
 * No-op for PROFILE === "online".
 */
export function ensureDataInstalled(): Promise<void> {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const profiles = PROFILE_INCLUDES[PROFILE];
    if (!profiles?.length) return;
    ensureDir(DATA_DIR);
    const manifest = await fetchManifest();
    const wanted = manifest.artifacts.filter((a) =>
      profiles.includes(a.profile)
    );
    console.error(
      `[mdm-data] profile=${PROFILE}, ${wanted.length} artifacts, cdn=${manifest.cdnBase}`
    );
    for (const a of wanted) {
      try {
        await downloadArtifact(a);
      } catch (err) {
        console.error(`[mdm-data] ${a.name} failed:`, err);
      }
    }
  })();
  return installPromise;
}

export function isDataInstalled(name: string): boolean {
  return existsSync(localPath(name));
}

export { CDN_BASE, DATA_DIR };
