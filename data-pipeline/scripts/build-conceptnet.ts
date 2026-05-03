/**
 * Builds a SQLite database from the ConceptNet 5.7 assertions dump.
 *
 * Source: https://github.com/commonsense/conceptnet5/wiki/Downloads
 * File:   https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz
 * Size:   ~1.2 GB compressed, ~9 GB uncompressed
 * Output: build/conceptnet.sqlite (~3 GB with indexes)
 *
 * The CSV is TSV-formatted with columns:
 *   uri  rel  start  end  metadata-json
 * Example row:
 *   /a/[/r/IsA/,/c/en/dog/,/c/en/animal/]  /r/IsA  /c/en/dog  /c/en/animal  {"weight": 2.0, ...}
 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { BUILD_DIR, DOWNLOAD_DIR, download, ensureDir } from "./common.js";

const CONCEPTNET_URL =
  "https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz";
const SOURCE_PATH = resolve(DOWNLOAD_DIR, "conceptnet-assertions-5.7.0.csv.gz");
const DB_PATH = resolve(BUILD_DIR, "conceptnet.sqlite");

interface Edge {
  rel: string;
  start: string;
  end: string;
  startLang: string;
  endLang: string;
  startLabel: string;
  endLabel: string;
  weight: number;
  surfaceText: string | null;
}

function parseConcept(uri: string): { lang: string; label: string } | null {
  const m = /^\/c\/([^/]+)\/([^/]+)/.exec(uri);
  if (!m) return null;
  return { lang: m[1], label: m[2].replace(/_/g, " ") };
}

function parseLine(line: string): Edge | null {
  const cols = line.split("\t");
  if (cols.length < 5) return null;
  const [, rel, start, end, metaJson] = cols;
  const startConcept = parseConcept(start);
  const endConcept = parseConcept(end);
  if (!startConcept || !endConcept) return null;
  let weight = 1;
  let surfaceText: string | null = null;
  try {
    const meta = JSON.parse(metaJson);
    if (typeof meta.weight === "number") weight = meta.weight;
    if (typeof meta.surfaceText === "string") surfaceText = meta.surfaceText;
  } catch {
    // ignore malformed meta
  }
  return {
    rel: rel.replace("/r/", ""),
    start,
    end,
    startLang: startConcept.lang,
    endLang: endConcept.lang,
    startLabel: startConcept.label,
    endLabel: endConcept.label,
    weight,
    surfaceText,
  };
}

async function main() {
  ensureDir(BUILD_DIR);
  await download(CONCEPTNET_URL, SOURCE_PATH);

  console.log(`[sqlite] writing ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -200000");
  db.exec(`
    DROP TABLE IF EXISTS edges;
    CREATE TABLE edges (
      rel          TEXT NOT NULL,
      start_uri    TEXT NOT NULL,
      end_uri      TEXT NOT NULL,
      start_lang   TEXT NOT NULL,
      end_lang     TEXT NOT NULL,
      start_label  TEXT NOT NULL,
      end_label    TEXT NOT NULL,
      weight       REAL NOT NULL,
      surface_text TEXT
    );
  `);

  const insert = db.prepare(
    `INSERT INTO edges (rel, start_uri, end_uri, start_lang, end_lang, start_label, end_label, weight, surface_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((batch: Edge[]) => {
    for (const e of batch) {
      insert.run(
        e.rel,
        e.start,
        e.end,
        e.startLang,
        e.endLang,
        e.startLabel,
        e.endLabel,
        e.weight,
        e.surfaceText
      );
    }
  });

  const rl = createInterface({
    input: createReadStream(SOURCE_PATH).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const BATCH = 5000;
  let buffer: Edge[] = [];
  let total = 0;
  const start = Date.now();
  for await (const line of rl) {
    const edge = parseLine(line);
    if (!edge) continue;
    buffer.push(edge);
    if (buffer.length >= BATCH) {
      insertMany(buffer);
      total += buffer.length;
      buffer = [];
      if (total % 500_000 === 0) {
        const elapsed = (Date.now() - start) / 1000;
        console.log(`  inserted ${total.toLocaleString()} edges (${(total / elapsed).toFixed(0)}/s)`);
      }
    }
  }
  if (buffer.length) {
    insertMany(buffer);
    total += buffer.length;
  }
  console.log(`[sqlite] inserted ${total.toLocaleString()} edges`);

  console.log(`[sqlite] creating indexes...`);
  db.exec(`
    CREATE INDEX idx_start ON edges(start_uri, rel);
    CREATE INDEX idx_end   ON edges(end_uri, rel);
    CREATE INDEX idx_rel   ON edges(rel);
    CREATE INDEX idx_start_lang ON edges(start_lang, start_label);
    CREATE INDEX idx_end_lang   ON edges(end_lang, end_label);
  `);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.close();
  console.log(`[done] ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
