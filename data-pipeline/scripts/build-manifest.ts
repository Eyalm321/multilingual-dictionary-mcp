/**
 * Walks build/ and produces a manifest.json with each artifact's
 * filename, size, sha256, content-type, and the install profile it belongs to.
 *
 * Profiles:
 *   small  — cmudict
 *   medium — small + conceptnet + numberbatch + 5 wiktextract langs
 *   full   — medium + all wiktextract langs + ngrams
 *
 * The runtime installer downloads only the chunks the user has opted into.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILD_DIR } from "./common.js";
import { sha256OfFile } from "./common.js";

const MANIFEST_VERSION = 1;
const CDN_BASE =
  process.env.MDM_CDN_BASE ||
  "https://multilingual-dictionary-mcp-data.nyc3.cdn.digitaloceanspaces.com";

const MEDIUM_LANGS = ["english", "spanish", "french", "italian", "portuguese"];

function profileFor(filename: string): "small" | "medium" | "full" {
  if (filename.startsWith("cmudict")) return "small";
  if (filename.startsWith("conceptnet")) return "medium";
  if (filename.startsWith("numberbatch")) return "medium";
  if (filename.startsWith("wiktextract-")) {
    const lang = filename.replace(/^wiktextract-/, "").replace(/\..*$/, "");
    return MEDIUM_LANGS.includes(lang) ? "medium" : "full";
  }
  if (filename.startsWith("ngrams")) return "full";
  return "full";
}

interface Artifact {
  name: string;
  url: string;
  size: number;
  sha256: string;
  profile: "small" | "medium" | "full";
}

async function main() {
  const artifacts: Artifact[] = [];
  for (const name of readdirSync(BUILD_DIR)) {
    const path = resolve(BUILD_DIR, name);
    if (!statSync(path).isFile()) continue;
    const size = statSync(path).size;
    const sha256 = await sha256OfFile(path);
    artifacts.push({
      name,
      url: `${CDN_BASE}/${name}`,
      size,
      sha256,
      profile: profileFor(name),
    });
    console.log(`  ${name} (${(size / 1_000_000).toFixed(1)} MB) — ${profileFor(name)}`);
  }
  const manifest = {
    version: MANIFEST_VERSION,
    builtAt: new Date().toISOString(),
    cdnBase: CDN_BASE,
    artifacts,
  };
  const manifestPath = resolve(BUILD_DIR, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[done] ${manifestPath} (${artifacts.length} artifacts)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
