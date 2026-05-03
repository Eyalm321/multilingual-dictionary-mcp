/**
 * Gzip-compresses every artifact in build/ in place — produces <name>.gz
 * alongside the original. Preserves originals so the manifest builder can
 * record both the decompressed sha256 (for post-extract verification) and
 * the compressed sha256 (for download verification).
 *
 * Skips files that don't compress meaningfully (numberbatch.bin is already
 * quantized int8 — gzip ratio is ~1.05x, not worth the CPU on the user's
 * side or the second-hash verification step).
 */
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { BUILD_DIR } from "./common";

// Files that don't compress well — leave as-is. The installer treats absent
// .gz as "download original directly".
const SKIP = new Set(["numberbatch.bin", "manifest.json"]);

async function gzipOne(src: string, dest: string) {
  console.log(
    `[compress] ${src} -> ${dest} (${(statSync(src).size / 1_000_000).toFixed(1)} MB)`
  );
  const start = Date.now();
  await pipeline(
    createReadStream(src),
    createGzip({ level: 6 }),
    createWriteStream(dest)
  );
  const elapsed = (Date.now() - start) / 1000;
  const origSize = statSync(src).size;
  const gzSize = statSync(dest).size;
  const ratio = origSize / gzSize;
  console.log(
    `  ${(gzSize / 1_000_000).toFixed(1)} MB (${ratio.toFixed(2)}x ratio, ${elapsed.toFixed(0)}s)`
  );
}

async function main() {
  const files = readdirSync(BUILD_DIR).filter((n) => {
    if (SKIP.has(n)) return false;
    if (n.endsWith(".gz")) return false;
    const p = resolve(BUILD_DIR, n);
    return statSync(p).isFile();
  });

  for (const name of files) {
    const src = resolve(BUILD_DIR, name);
    const dest = resolve(BUILD_DIR, `${name}.gz`);
    if (existsSync(dest) && statSync(dest).mtimeMs > statSync(src).mtimeMs) {
      console.log(`[skip] ${dest} already exists and is newer`);
      continue;
    }
    await gzipOne(src, dest);
  }
  console.log("[done] all artifacts compressed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
