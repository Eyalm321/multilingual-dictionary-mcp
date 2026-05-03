import { createWriteStream, existsSync, mkdirSync, statSync, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

export const ROOT = resolve(__dirname, "..");
export const BUILD_DIR = resolve(ROOT, "build");
export const DOWNLOAD_DIR = resolve(ROOT, "downloads");

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

ensureDir(BUILD_DIR);
ensureDir(DOWNLOAD_DIR);

export async function download(
  url: string,
  destPath: string,
  options: { force?: boolean } = {}
): Promise<void> {
  ensureDir(dirname(destPath));
  if (existsSync(destPath) && !options.force) {
    console.log(`[skip] ${destPath} already exists`);
    return;
  }
  console.log(`[download] ${url} -> ${destPath}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status} ${res.statusText} for ${url}`);
  }
  const total = Number(res.headers.get("content-length") || 0);
  let received = 0;
  let lastLogged = 0;
  const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
  const out = createWriteStream(destPath);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(value);
    received += value.byteLength;
    if (total > 0 && received - lastLogged > 50_000_000) {
      const pct = ((received / total) * 100).toFixed(1);
      console.log(`  ${pct}% (${(received / 1_000_000).toFixed(0)}MB / ${(total / 1_000_000).toFixed(0)}MB)`);
      lastLogged = received;
    }
  }
  out.end();
  await new Promise((r) => out.on("close", r));
}

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export function fileSize(path: string): number {
  return statSync(path).size;
}

export function logProgress<T>(
  label: string,
  total: number,
  generator: AsyncGenerator<T> | Generator<T>
) {
  let count = 0;
  let lastLogged = Date.now();
  return (async function* () {
    for await (const item of generator as AsyncGenerator<T>) {
      count += 1;
      const now = Date.now();
      if (now - lastLogged > 5000) {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "?";
        console.log(`  [${label}] ${count.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`);
        lastLogged = now;
      }
      yield item;
    }
    console.log(`  [${label}] done — ${count.toLocaleString()} items`);
  })();
}
