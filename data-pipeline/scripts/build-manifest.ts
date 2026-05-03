/**
 * Walks build/ and produces a manifest.json with each artifact's
 * filename, decompressed and compressed sizes + sha256, and content-type.
 *
 * The runtime installer downloads ALL artifacts in the manifest. There's
 * no profile system — the bundle is what it is. It prefers compressedUrl
 * when present (gzip-decoding stream to disk), falling back to url for
 * files that aren't worth compressing (numberbatch.bin).
 */
import { readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { BUILD_DIR, sha256OfFile } from "./common";

const MANIFEST_VERSION = 3;
const CDN_BASE =
  process.env.MDM_CDN_BASE ||
  "https://multilingual-dictionary-mcp-data.nyc3.cdn.digitaloceanspaces.com";

interface Artifact {
  name: string;
  url: string;
  size: number;
  sha256: string;
  compressedUrl?: string;
  compressedSize?: number;
  compressedSha256?: string;
}

async function main() {
  const artifacts: Artifact[] = [];
  const allNames = readdirSync(BUILD_DIR);
  const decompressedNames = allNames.filter((n) => {
    if (n === "manifest.json") return false;
    if (n.endsWith(".gz")) return false;
    return statSync(resolve(BUILD_DIR, n)).isFile();
  });

  for (const name of decompressedNames) {
    const path = resolve(BUILD_DIR, name);
    const size = statSync(path).size;
    const sha256 = await sha256OfFile(path);
    const gzPath = resolve(BUILD_DIR, `${name}.gz`);
    let compressed:
      | { url: string; size: number; sha256: string }
      | undefined;
    if (existsSync(gzPath)) {
      const gzSize = statSync(gzPath).size;
      // Skip the compressed version if it's not meaningfully smaller —
      // tiny files have gzip header overhead that exceeds savings.
      if (gzSize < size * 0.95) {
        const gzSha = await sha256OfFile(gzPath);
        compressed = {
          url: `${CDN_BASE}/${name}.gz`,
          size: gzSize,
          sha256: gzSha,
        };
      }
    }
    artifacts.push({
      name,
      url: `${CDN_BASE}/${name}`,
      size,
      sha256,
      compressedUrl: compressed?.url,
      compressedSize: compressed?.size,
      compressedSha256: compressed?.sha256,
    });
    const origMb = (size / 1_000_000).toFixed(1);
    const gzMb = compressed ? (compressed.size / 1_000_000).toFixed(1) : "—";
    console.log(
      `  ${name.padEnd(28)} ${origMb.padStart(8)} MB / gz ${gzMb.padStart(7)} MB`
    );
  }

  const manifest = {
    version: MANIFEST_VERSION,
    builtAt: new Date().toISOString(),
    cdnBase: CDN_BASE,
    artifacts,
  };
  const manifestPath = resolve(BUILD_DIR, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const totalOrig = artifacts.reduce((s, a) => s + a.size, 0);
  const totalGz = artifacts.reduce(
    (s, a) => s + (a.compressedSize ?? a.size),
    0
  );
  console.log(
    `[done] ${manifestPath} — ${artifacts.length} artifacts, ${(totalOrig / 1_000_000_000).toFixed(2)} GB raw, ${(totalGz / 1_000_000_000).toFixed(2)} GB on the wire`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
