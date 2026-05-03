/**
 * Builds a binary float matrix + concept index from ConceptNet Numberbatch 19.08.
 *
 * Source: https://github.com/commonsense/conceptnet-numberbatch
 * File:   https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-19.08.txt.gz
 * Size:   ~1.4 GB compressed, ~5 GB uncompressed (16.7M concepts x 300d float32)
 * Output:
 *   build/numberbatch.bin   — flat int8-quantized matrix (rows = concepts, cols = 300)
 *   build/numberbatch.idx   — concept URI -> row index (binary, fixed-width)
 *
 * Input format (text):
 *   <num-rows> <dim>
 *   /c/en/dog 0.012 -0.034 ... (300 floats)
 *   /c/es/perro -0.011 ...
 *
 * The output is consumed by src/data/numberbatch.ts at runtime.
 */
import { createReadStream, createWriteStream, openSync, writeSync, closeSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { BUILD_DIR, DOWNLOAD_DIR, download } from "./common.js";

const NB_URL =
  "https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-19.08.txt.gz";
const SOURCE_PATH = resolve(DOWNLOAD_DIR, "numberbatch-19.08.txt.gz");
const MATRIX_PATH = resolve(BUILD_DIR, "numberbatch.bin");
const INDEX_PATH = resolve(BUILD_DIR, "numberbatch.idx.json");

const DIM = 300;

function quantize(v: number): number {
  const clipped = Math.max(-1, Math.min(1, v));
  return Math.round(clipped * 127);
}

async function main() {
  await download(NB_URL, SOURCE_PATH);

  const rl = createInterface({
    input: createReadStream(SOURCE_PATH).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let header: { rows: number; dim: number } | null = null;
  const conceptToRow: Record<string, number> = {};
  const matrixFd = openSync(MATRIX_PATH, "w");
  let row = 0;
  const start = Date.now();

  for await (const line of rl) {
    if (!header) {
      const [rows, dim] = line.trim().split(/\s+/).map(Number);
      header = { rows, dim };
      if (dim !== DIM) {
        throw new Error(`Expected ${DIM}-dim vectors, got ${dim}`);
      }
      console.log(`[numberbatch] ${rows.toLocaleString()} rows x ${dim}d`);
      continue;
    }
    const parts = line.split(" ");
    const concept = parts[0];
    if (parts.length !== DIM + 1) {
      console.warn(`bad row at ${row}: ${parts.length - 1} dims`);
      continue;
    }
    const buf = Buffer.alloc(DIM);
    for (let i = 0; i < DIM; i += 1) {
      const v = Number(parts[i + 1]);
      buf.writeInt8(quantize(v), i);
    }
    writeSync(matrixFd, buf);
    conceptToRow[concept] = row;
    row += 1;
    if (row % 500_000 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      console.log(`  ${row.toLocaleString()} rows (${(row / elapsed).toFixed(0)}/s)`);
    }
  }
  closeSync(matrixFd);
  console.log(`[numberbatch] wrote ${row.toLocaleString()} rows -> ${MATRIX_PATH}`);

  const indexJson = JSON.stringify({ dim: DIM, rows: row, conceptToRow });
  await new Promise<void>((res, rej) => {
    const out = createWriteStream(INDEX_PATH);
    out.write(indexJson);
    out.end();
    out.on("close", () => res());
    out.on("error", rej);
  });
  console.log(`[done] ${INDEX_PATH} (${(indexJson.length / 1_000_000).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
