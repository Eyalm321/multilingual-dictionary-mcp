/**
 * Builds ONE SQLite from Kaikki's full raw Wiktextract dump that covers
 * every language section in the English Wiktionary (~3000 languages).
 *
 * Source: https://kaikki.org/raw-wiktextract-data.jsonl.gz
 * Size:   2.4 GB compressed -> 20.5 GB uncompressed
 * Output: build/wiktextract-all.sqlite (~10-15 GB indexed)
 *
 * Schema is the same as the per-language SQLites; the difference is that
 * lang_code is varied and indexed so a single (word, lang_code) lookup hits
 * the right row regardless of which language Wiktionary describes the word in.
 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { BUILD_DIR, DOWNLOAD_DIR, download } from "./common";

const URL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz";
const SOURCE_PATH = resolve(DOWNLOAD_DIR, "raw-wiktextract-data.jsonl.gz");
const DB_PATH = resolve(BUILD_DIR, "wiktextract-all.sqlite");

interface WiktextractEntry {
  word: string;
  pos?: string;
  lang_code?: string;
  senses?: unknown[];
  etymology_text?: string;
  sounds?: Array<{ ipa?: string }>;
  translations?: unknown[];
}

async function main() {
  await download(URL, SOURCE_PATH);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -200000");
  db.exec(`
    DROP TABLE IF EXISTS entries;
    CREATE TABLE entries (
      word              TEXT NOT NULL,
      lang_code         TEXT NOT NULL,
      pos               TEXT,
      senses_json       TEXT NOT NULL,
      etymology         TEXT,
      ipa               TEXT,
      translations_json TEXT
    );
  `);
  const insert = db.prepare(
    `INSERT INTO entries (word, lang_code, pos, senses_json, etymology, ipa, translations_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((rows: any[][]) => {
    for (const r of rows) insert.run(...r);
  });

  const rl = createInterface({
    input: createReadStream(SOURCE_PATH).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const buffer: any[][] = [];
  let total = 0;
  let skipped = 0;
  const start = Date.now();
  for await (const line of rl) {
    if (!line) continue;
    let entry: WiktextractEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!entry.word || !entry.lang_code) {
      skipped += 1;
      continue;
    }
    const ipa =
      entry.sounds
        ?.map((s) => s.ipa)
        .filter((x): x is string => typeof x === "string")
        .join(" | ") || null;
    buffer.push([
      entry.word.toLowerCase(),
      entry.lang_code,
      entry.pos || null,
      JSON.stringify(entry.senses || []),
      entry.etymology_text || null,
      ipa,
      JSON.stringify(entry.translations || []),
    ]);
    if (buffer.length >= 5000) {
      insertMany(buffer);
      total += buffer.length;
      buffer.length = 0;
      if (total % 500_000 === 0) {
        const elapsed = (Date.now() - start) / 1000;
        console.log(
          `  inserted ${total.toLocaleString()} entries (${(total / elapsed).toFixed(0)}/s, ${skipped.toLocaleString()} skipped)`
        );
      }
    }
  }
  if (buffer.length) {
    insertMany(buffer);
    total += buffer.length;
  }
  console.log(`[wiktextract-all] inserted ${total.toLocaleString()} entries`);

  console.log(`[wiktextract-all] creating indexes...`);
  db.exec(`
    CREATE INDEX idx_word_lang ON entries(word, lang_code);
    CREATE INDEX idx_lang ON entries(lang_code);
  `);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.close();
  console.log(`[done] ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
