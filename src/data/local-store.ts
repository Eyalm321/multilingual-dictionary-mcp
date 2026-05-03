/**
 * Optional local data store. Wraps SQLite databases produced by data-pipeline/
 * and the Numberbatch binary matrix. Returns undefined when local data isn't
 * available, so callers can fall back to the online APIs.
 */
import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { localPath } from "./paths.js";

type SqliteCtor = new (path: string, options?: { readonly?: boolean }) => SqliteDb;
interface SqliteDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  pragma(sql: string): unknown;
  close(): void;
}

let sqliteCtor: SqliteCtor | null | undefined;
function getSqlite(): SqliteCtor | null {
  if (sqliteCtor !== undefined) return sqliteCtor;
  try {
    // optional dependency — graceful fallback if absent
    const mod = require("better-sqlite3") as SqliteCtor;
    sqliteCtor = mod;
  } catch {
    sqliteCtor = null;
  }
  return sqliteCtor;
}

function openReadonly(path: string): SqliteDb | null {
  if (!existsSync(path)) return null;
  const Ctor = getSqlite();
  if (!Ctor) return null;
  const db = new Ctor(path, { readonly: true });
  db.pragma("query_only = 1");
  return db;
}

let cachedConceptNet: SqliteDb | null = null;
function conceptnetDb(): SqliteDb | null {
  if (cachedConceptNet) return cachedConceptNet;
  cachedConceptNet = openReadonly(localPath("conceptnet.sqlite"));
  return cachedConceptNet;
}

let cachedCmu: SqliteDb | null = null;
function cmuDb(): SqliteDb | null {
  if (cachedCmu) return cachedCmu;
  cachedCmu = openReadonly(localPath("cmudict.sqlite"));
  return cachedCmu;
}

let cachedWiktextract: SqliteDb | null = null;
function wiktextractDb(): SqliteDb | null {
  if (cachedWiktextract) return cachedWiktextract;
  cachedWiktextract = openReadonly(localPath("wiktextract-all.sqlite"));
  return cachedWiktextract;
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, "_");
}

export interface LocalEdge {
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

export function localConceptNetEdges(opts: {
  word: string;
  language: string;
  rel?: string;
  direction?: "start" | "end" | "any";
  otherLanguage?: string;
  limit: number;
}): LocalEdge[] | undefined {
  const db = conceptnetDb();
  if (!db) return undefined;
  const node = `/c/${opts.language}/${normalizeWord(opts.word)}`;
  const direction = opts.direction ?? "any";
  const where: string[] = [];
  const params: unknown[] = [];
  if (direction === "start" || direction === "any") {
    where.push("start_uri = ?");
    params.push(node);
  }
  if (direction === "end") {
    where.push("end_uri = ?");
    params.push(node);
  }
  let whereSql = direction === "any" ? "(start_uri = ? OR end_uri = ?)" : where.join(" AND ");
  let actualParams: unknown[] = direction === "any" ? [node, node] : params;
  if (opts.rel) {
    whereSql += " AND rel = ?";
    actualParams.push(opts.rel);
  }
  if (opts.otherLanguage) {
    whereSql += " AND (start_lang = ? OR end_lang = ?)";
    actualParams.push(opts.otherLanguage, opts.otherLanguage);
  }
  const rows = db
    .prepare(
      `SELECT rel, start_uri, end_uri, start_lang, end_lang, start_label, end_label, weight, surface_text
       FROM edges
       WHERE ${whereSql}
       ORDER BY weight DESC
       LIMIT ?`
    )
    .all(...actualParams, opts.limit) as Array<{
    rel: string;
    start_uri: string;
    end_uri: string;
    start_lang: string;
    end_lang: string;
    start_label: string;
    end_label: string;
    weight: number;
    surface_text: string | null;
  }>;
  return rows.map((r) => ({
    rel: r.rel,
    start: r.start_uri,
    end: r.end_uri,
    startLang: r.start_lang,
    endLang: r.end_lang,
    startLabel: r.start_label,
    endLabel: r.end_label,
    weight: r.weight,
    surfaceText: r.surface_text,
  }));
}

export interface RhymeEntry {
  word: string;
  numSyllables: number;
  phones: string;
}

export function localRhymes(
  word: string,
  perfect: boolean,
  limit: number
): RhymeEntry[] | undefined {
  const db = cmuDb();
  if (!db) return undefined;
  const lower = word.toLowerCase();
  const seedRows = db
    .prepare("SELECT rhyme_key, near_rhyme_key FROM pron WHERE word = ? LIMIT 1")
    .all(lower) as Array<{ rhyme_key: string; near_rhyme_key: string }>;
  if (!seedRows.length) return [];
  const seed = seedRows[0];
  const keyCol = perfect ? "rhyme_key" : "near_rhyme_key";
  const keyVal = perfect ? seed.rhyme_key : seed.near_rhyme_key;
  const rows = db
    .prepare(
      `SELECT word, num_syllables AS numSyllables, phones
       FROM pron WHERE ${keyCol} = ? AND word != ? LIMIT ?`
    )
    .all(keyVal, lower, limit) as RhymeEntry[];
  return rows;
}

export interface CmuRow {
  word: string;
  numSyllables: number;
  phones: string;
}

export function localSpelledLike(
  pattern: string,
  limit: number
): CmuRow[] | undefined {
  const db = cmuDb();
  if (!db) return undefined;
  // CMU "?" -> SQL "_", "*" -> "%"
  const sqlPattern = pattern.toLowerCase().replace(/\?/g, "_").replace(/\*/g, "%");
  return db
    .prepare(
      "SELECT word, num_syllables AS numSyllables, phones FROM pron WHERE word LIKE ? LIMIT ?"
    )
    .all(sqlPattern, limit) as CmuRow[];
}

export function localSuggest(
  prefix: string,
  limit: number
): CmuRow[] | undefined {
  const db = cmuDb();
  if (!db) return undefined;
  return db
    .prepare(
      "SELECT word, num_syllables AS numSyllables, phones FROM pron WHERE word LIKE ? ORDER BY length(word) ASC LIMIT ?"
    )
    .all(prefix.toLowerCase() + "%", limit) as CmuRow[];
}

export function localSoundsLike(
  word: string,
  limit: number
): RhymeEntry[] | undefined {
  const db = cmuDb();
  if (!db) return undefined;
  const lower = word.toLowerCase();
  const seedRows = db
    .prepare("SELECT sound_key FROM pron WHERE word = ? LIMIT 1")
    .all(lower) as Array<{ sound_key: string }>;
  if (!seedRows.length) return [];
  return db
    .prepare(
      `SELECT word, num_syllables AS numSyllables, phones
       FROM pron WHERE sound_key = ? AND word != ? LIMIT ?`
    )
    .all(seedRows[0].sound_key, lower, limit) as RhymeEntry[];
}

/** Wiktextract row shape from the all-languages SQLite. */
export interface WiktextractRow {
  word: string;
  lang_code: string;
  pos: string | null;
  senses_json: string;
  etymology: string | null;
  ipa: string | null;
  translations_json: string;
}

export function localWiktextractByWord(
  word: string,
  language?: string,
  limit: number = 100
): WiktextractRow[] | undefined {
  const db = wiktextractDb();
  if (!db) return undefined;
  const lower = word.toLowerCase();
  if (language) {
    return db
      .prepare(
        "SELECT word, lang_code, pos, senses_json, etymology, ipa, translations_json FROM entries WHERE word = ? AND lang_code = ? LIMIT ?"
      )
      .all(lower, language, limit) as WiktextractRow[];
  }
  return db
    .prepare(
      "SELECT word, lang_code, pos, senses_json, etymology, ipa, translations_json FROM entries WHERE word = ? LIMIT ?"
    )
    .all(lower, limit) as WiktextractRow[];
}

export function localWiktextractSearch(
  query: string,
  language?: string,
  limit: number = 10
): Array<{ word: string; lang_code: string; pos: string | null }> | undefined {
  const db = wiktextractDb();
  if (!db) return undefined;
  const sqlPattern = query.toLowerCase() + "%";
  if (language) {
    return db
      .prepare(
        "SELECT DISTINCT word, lang_code, pos FROM entries WHERE word LIKE ? AND lang_code = ? ORDER BY length(word) ASC LIMIT ?"
      )
      .all(sqlPattern, language, limit) as Array<{
      word: string;
      lang_code: string;
      pos: string | null;
    }>;
  }
  return db
    .prepare(
      "SELECT DISTINCT word, lang_code, pos FROM entries WHERE word LIKE ? ORDER BY length(word) ASC LIMIT ?"
    )
    .all(sqlPattern, limit) as Array<{
    word: string;
    lang_code: string;
    pos: string | null;
  }>;
}

export function localWiktextractRandom(
  language?: string
): WiktextractRow | undefined | null {
  const db = wiktextractDb();
  if (!db) return undefined;
  if (language) {
    const rows = db
      .prepare(
        "SELECT word, lang_code, pos, senses_json, etymology, ipa, translations_json FROM entries WHERE lang_code = ? ORDER BY RANDOM() LIMIT 1"
      )
      .all(language) as WiktextractRow[];
    return rows[0] ?? null;
  }
  const rows = db
    .prepare(
      "SELECT word, lang_code, pos, senses_json, etymology, ipa, translations_json FROM entries ORDER BY RANDOM() LIMIT 1"
    )
    .all() as WiktextractRow[];
  return rows[0] ?? null;
}

interface NumberbatchIndex {
  dim: number;
  rows: number;
  conceptToRow: Map<string, number>;
}
let nbIndex: NumberbatchIndex | null | undefined;
let nbMatrixFd: number | null = null;

function loadNumberbatch():
  | { index: NumberbatchIndex; fd: number }
  | undefined {
  if (nbIndex === null) return undefined;
  if (!nbIndex) {
    const idxPath = localPath("numberbatch.idx.tsv");
    const metaPath = localPath("numberbatch.meta.json");
    const matPath = localPath("numberbatch.bin");
    if (!existsSync(idxPath) || !existsSync(metaPath) || !existsSync(matPath)) {
      nbIndex = null;
      return undefined;
    }
    try {
      const fs = require("node:fs");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
        dim: number;
        rows: number;
      };
      const tsv = fs.readFileSync(idxPath, "utf8") as string;
      const map = new Map<string, number>();
      let i = 0;
      while (i < tsv.length) {
        const tab = tsv.indexOf("\t", i);
        if (tab < 0) break;
        const nl = tsv.indexOf("\n", tab + 1);
        if (nl < 0) break;
        map.set(tsv.slice(i, tab), Number(tsv.slice(tab + 1, nl)));
        i = nl + 1;
      }
      nbIndex = { dim: meta.dim, rows: meta.rows, conceptToRow: map };
      nbMatrixFd = openSync(matPath, "r");
    } catch {
      nbIndex = null;
      return undefined;
    }
  }
  return { index: nbIndex, fd: nbMatrixFd! };
}

function readVector(fd: number, dim: number, row: number): Int8Array {
  const buf = Buffer.alloc(dim);
  readSync(fd, buf, 0, dim, row * dim);
  return new Int8Array(buf.buffer, buf.byteOffset, dim);
}

function cosineInt8(a: Int8Array, b: Int8Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface NumberbatchNeighbor {
  concept: string;
  similarity: number;
}

export function localNumberbatchNeighbors(
  word: string,
  language: string,
  limit: number,
  opts: { targetLanguage?: string } = {}
): NumberbatchNeighbor[] | undefined {
  const nb = loadNumberbatch();
  if (!nb) return undefined;
  const concept = `/c/${language}/${normalizeWord(word)}`;
  const seedRow = nb.index.conceptToRow.get(concept);
  if (seedRow === undefined) return [];
  const seed = readVector(nb.fd, nb.index.dim, seedRow);
  const langPrefix = opts.targetLanguage ? `/c/${opts.targetLanguage}/` : null;
  const heap: NumberbatchNeighbor[] = [];
  let heapMin = -Infinity;
  for (const [c, row] of nb.index.conceptToRow) {
    if (c === concept) continue;
    if (langPrefix && !c.startsWith(langPrefix)) continue;
    const v = readVector(nb.fd, nb.index.dim, row);
    const sim = cosineInt8(seed, v);
    if (heap.length < limit) {
      heap.push({ concept: c, similarity: sim });
      if (heap.length === limit) {
        heap.sort((a, b) => a.similarity - b.similarity);
        heapMin = heap[0].similarity;
      }
    } else if (sim > heapMin) {
      heap[0] = { concept: c, similarity: sim };
      heap.sort((a, b) => a.similarity - b.similarity);
      heapMin = heap[0].similarity;
    }
  }
  return heap.sort((a, b) => b.similarity - a.similarity);
}
