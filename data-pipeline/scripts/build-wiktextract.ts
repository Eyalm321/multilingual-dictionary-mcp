/**
 * Builds per-language SQLite databases from Kaikki.org Wiktextract JSON dumps.
 *
 * Source: https://kaikki.org/dictionary/rawdata.html
 * Files:  https://kaikki.org/dictionary/{LanguageName}/kaikki.org-dictionary-{LanguageName}.jsonl
 * Sizes:  English ~1.5GB, French ~700MB, Spanish ~400MB, others 50-300MB
 * Output: build/wiktextract-{lang}.sqlite per language
 *
 * Configure languages via WIKTEXTRACT_LANGS env var (comma-separated names).
 * Default: a sensible top-10 list.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { BUILD_DIR, DOWNLOAD_DIR, download } from "./common";

const DEFAULT_LANGS = [
  "English",
  "Spanish",
  "French",
  "Italian",
  "Portuguese",
  "German",
  "Dutch",
  "Russian",
  "Hebrew",
  "Arabic",
  "Latin",
  "Japanese",
  "Chinese",
];

const langs =
  process.env.WIKTEXTRACT_LANGS
    ? process.env.WIKTEXTRACT_LANGS.split(",").map((s) => s.trim())
    : DEFAULT_LANGS;

interface WiktextractEntry {
  word: string;
  pos?: string;
  lang_code?: string;
  senses?: Array<{
    glosses?: string[];
    examples?: Array<{ text?: string }>;
    synonyms?: Array<{ word: string; sense?: string }>;
    antonyms?: Array<{ word: string }>;
    hypernyms?: Array<{ word: string }>;
    hyponyms?: Array<{ word: string }>;
    meronyms?: Array<{ word: string }>;
    holonyms?: Array<{ word: string }>;
    related?: Array<{ word: string }>;
  }>;
  etymology_text?: string;
  sounds?: Array<{ ipa?: string; tags?: string[] }>;
  translations?: Array<{ word: string; lang: string; lang_code?: string }>;
}

async function buildOne(lang: string) {
  const slug = lang.replace(/\s+/g, "_");
  const url = `https://kaikki.org/dictionary/${slug}/kaikki.org-dictionary-${slug}.jsonl`;
  const sourcePath = resolve(DOWNLOAD_DIR, `wiktextract-${slug}.jsonl`);
  const dbPath = resolve(BUILD_DIR, `wiktextract-${slug.toLowerCase()}.sqlite`);
  await download(url, sourcePath);

  const db = new Database(dbPath);
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.exec(`
    DROP TABLE IF EXISTS entries;
    CREATE TABLE entries (
      word           TEXT NOT NULL,
      lang_code      TEXT NOT NULL,
      pos            TEXT,
      senses_json    TEXT NOT NULL,
      etymology      TEXT,
      ipa            TEXT,
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
    input: createReadStream(sourcePath),
    crlfDelay: Infinity,
  });

  const buffer: any[][] = [];
  let total = 0;
  for await (const line of rl) {
    if (!line) continue;
    let entry: WiktextractEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ipa =
      entry.sounds
        ?.map((s) => s.ipa)
        .filter((x): x is string => typeof x === "string")
        .join(" | ") || null;
    buffer.push([
      entry.word.toLowerCase(),
      entry.lang_code || "",
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
    }
  }
  if (buffer.length) {
    insertMany(buffer);
    total += buffer.length;
  }
  db.exec(`CREATE INDEX idx_word ON entries(word);`);
  db.close();
  console.log(`[${lang}] ${total.toLocaleString()} entries -> ${dbPath}`);
}

async function main() {
  for (const lang of langs) {
    try {
      await buildOne(lang);
    } catch (err) {
      console.error(`[${lang}] failed:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
