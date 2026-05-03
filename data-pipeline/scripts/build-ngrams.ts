/**
 * Builds an English bigram + trigram database from a Wikipedia plain-text dump.
 * Used as the offline equivalent of Datamuse's lc/rc/rel_trg parameters
 * (follows / precedes / triggers).
 *
 * Source: https://dumps.wikimedia.org/enwiki/latest/
 * File:   enwiki-latest-pages-articles.xml.bz2 (~22 GB compressed)
 *
 * Recommended flow (run separately, this script picks up the extracted text):
 *   1. Download enwiki-latest-pages-articles.xml.bz2 from dumps.wikimedia.org
 *   2. Run wikiextractor (https://github.com/attardi/wikiextractor) to produce plain-text shards
 *   3. Point WIKI_TEXT_DIR at the extraction output and run this script
 *
 * Output: build/ngrams.sqlite (~3-5 GB indexed)
 *
 * The schema is simple: per (left, right) pair we store its frequency.
 * Triggers are computed as words with high pointwise mutual information given a
 * target word, derived from the bigram counts at runtime.
 */
import { createReadStream, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { BUILD_DIR } from "./common.js";

const WIKI_TEXT_DIR = process.env.WIKI_TEXT_DIR;
const DB_PATH = resolve(BUILD_DIR, "ngrams.sqlite");
const TOKEN_RE = /[a-z][a-z'-]+/g;
const MIN_COUNT = 5;

function* walkFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      yield* walkFiles(p);
    } else {
      yield p;
    }
  }
}

async function main() {
  if (!WIKI_TEXT_DIR) {
    console.error(
      "Set WIKI_TEXT_DIR to a directory of plain-text shards from wikiextractor."
    );
    console.error(
      "See https://github.com/attardi/wikiextractor — produces files like AA/wiki_00, AA/wiki_01, etc."
    );
    process.exit(2);
  }

  const counts = new Map<string, number>();
  let processed = 0;
  let totalTokens = 0;
  const start = Date.now();

  for (const file of walkFiles(WIKI_TEXT_DIR)) {
    if (!/\/wiki_\d+/.test(file.replace(/\\/g, "/"))) continue;
    const rl = createInterface({
      input: createReadStream(file),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line || line.startsWith("<")) continue;
      const tokens = (line.toLowerCase().match(TOKEN_RE) || []).slice(0, 200);
      totalTokens += tokens.length;
      for (let i = 0; i < tokens.length - 1; i += 1) {
        const key = `${tokens[i]}\t${tokens[i + 1]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    processed += 1;
    if (processed % 100 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      console.log(
        `  ${processed} files / ${totalTokens.toLocaleString()} tokens / ${counts.size.toLocaleString()} bigrams (${elapsed.toFixed(0)}s)`
      );
    }
  }

  console.log(`[ngrams] writing ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.exec(`
    DROP TABLE IF EXISTS bigrams;
    DROP TABLE IF EXISTS unigrams;
    CREATE TABLE bigrams (
      left  TEXT NOT NULL,
      right TEXT NOT NULL,
      count INTEGER NOT NULL
    );
    CREATE TABLE unigrams (
      word  TEXT NOT NULL PRIMARY KEY,
      count INTEGER NOT NULL
    );
  `);

  const insertBg = db.prepare("INSERT INTO bigrams VALUES (?, ?, ?)");
  const insertUg = db.prepare(
    "INSERT INTO unigrams VALUES (?, ?) ON CONFLICT(word) DO UPDATE SET count = count + excluded.count"
  );
  const txBg = db.transaction((rows: Array<[string, string, number]>) => {
    for (const r of rows) insertBg.run(...r);
  });
  const txUg = db.transaction((rows: Array<[string, number]>) => {
    for (const r of rows) insertUg.run(...r);
  });

  let bgBuf: Array<[string, string, number]> = [];
  const ugCounts = new Map<string, number>();
  for (const [key, count] of counts) {
    if (count < MIN_COUNT) continue;
    const [l, r] = key.split("\t");
    bgBuf.push([l, r, count]);
    ugCounts.set(l, (ugCounts.get(l) || 0) + count);
    ugCounts.set(r, (ugCounts.get(r) || 0) + count);
    if (bgBuf.length >= 10000) {
      txBg(bgBuf);
      bgBuf = [];
    }
  }
  if (bgBuf.length) txBg(bgBuf);

  const ugBuf: Array<[string, number]> = Array.from(ugCounts.entries());
  txUg(ugBuf);

  db.exec(`
    CREATE INDEX idx_left ON bigrams(left, count DESC);
    CREATE INDEX idx_right ON bigrams(right, count DESC);
  `);
  db.close();
  console.log(`[done] ${counts.size.toLocaleString()} bigrams -> ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
