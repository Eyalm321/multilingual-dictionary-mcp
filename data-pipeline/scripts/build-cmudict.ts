/**
 * Builds a SQLite from the CMU Pronouncing Dictionary for offline rhymes / sounds-like.
 *
 * Source: https://github.com/cmusphinx/cmudict
 * File:   https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
 * Size:   ~3 MB
 * Output: build/cmudict.sqlite
 *
 * The CMU dict gives ARPAbet pronunciations. We index by:
 *   - Final-stressed-syllable rhyme key (perfect rhymes)
 *   - Reverse-phoneme key (near rhymes)
 *   - Full phoneme key (sounds-like / homophones)
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { BUILD_DIR, DOWNLOAD_DIR, download } from "./common";

const URL =
  "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict";
const SOURCE_PATH = resolve(DOWNLOAD_DIR, "cmudict.dict");
const DB_PATH = resolve(BUILD_DIR, "cmudict.sqlite");

function rhymeKey(phones: string[]): string {
  // last primary-stressed vowel through end
  for (let i = phones.length - 1; i >= 0; i -= 1) {
    if (phones[i].endsWith("1") || phones[i].endsWith("2")) {
      return phones.slice(i).join(" ");
    }
  }
  return phones.slice(-2).join(" ");
}

function nearRhymeKey(phones: string[]): string {
  return phones.slice(-2).join(" ");
}

async function main() {
  await download(URL, SOURCE_PATH);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.exec(`
    DROP TABLE IF EXISTS pron;
    CREATE TABLE pron (
      word           TEXT NOT NULL,
      phones         TEXT NOT NULL,
      rhyme_key      TEXT NOT NULL,
      near_rhyme_key TEXT NOT NULL,
      sound_key      TEXT NOT NULL,
      num_syllables  INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(
    "INSERT INTO pron (word, phones, rhyme_key, near_rhyme_key, sound_key, num_syllables) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction(
    (rows: Array<[string, string, string, string, string, number]>) => {
      for (const r of rows) insert.run(...r);
    }
  );

  const rl = createInterface({
    input: createReadStream(SOURCE_PATH),
    crlfDelay: Infinity,
  });

  const buffer: Array<[string, string, string, string, string, number]> = [];
  let total = 0;
  for await (const line of rl) {
    if (!line || line.startsWith(";;;")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    let word = parts[0];
    word = word.replace(/\(\d+\)$/, "");
    const phones = parts.slice(1);
    const numSyllables = phones.filter((p) => /[012]$/.test(p)).length;
    buffer.push([
      word.toLowerCase(),
      phones.join(" "),
      rhymeKey(phones),
      nearRhymeKey(phones),
      phones.map((p) => p.replace(/\d/g, "")).join(" "),
      numSyllables,
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

  db.exec(`
    CREATE INDEX idx_word ON pron(word);
    CREATE INDEX idx_rhyme ON pron(rhyme_key);
    CREATE INDEX idx_near ON pron(near_rhyme_key);
    CREATE INDEX idx_sound ON pron(sound_key);
  `);
  db.close();
  console.log(`[done] ${total.toLocaleString()} pronunciations -> ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
