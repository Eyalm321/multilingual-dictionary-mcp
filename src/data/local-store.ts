/**
 * Optional local data store. Wraps SQLite databases produced by data-pipeline/
 * and the Numberbatch binary matrix. Returns undefined when local data isn't
 * available, so callers can fall back to the online APIs.
 */
import { existsSync, statSync } from "node:fs";
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
  rowConcepts: string[]; // row index -> concept URI (for fast reverse lookup)
  matrix: Int8Array; // entire 2.7 GB matrix loaded once
  norms: Float32Array; // pre-computed L2 norms per row, so cosine = dot/(norm_a*norm_b)
}
let nbIndex: NumberbatchIndex | null | undefined;

function loadNumberbatch(): NumberbatchIndex | undefined {
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
      // Load the entire matrix into memory once. ~2.7 GB at int8 — fits in
      // RAM on any modern machine and avoids 9M syscalls per cosine query.
      const matrixBuf = fs.readFileSync(matPath) as Buffer;
      const matrix = new Int8Array(
        matrixBuf.buffer,
        matrixBuf.byteOffset,
        matrixBuf.byteLength
      );

      const tsv = fs.readFileSync(idxPath, "utf8") as string;
      const map = new Map<string, number>();
      const rowConcepts: string[] = new Array(meta.rows);
      let i = 0;
      while (i < tsv.length) {
        const tab = tsv.indexOf("\t", i);
        if (tab < 0) break;
        const nl = tsv.indexOf("\n", tab + 1);
        if (nl < 0) break;
        const concept = tsv.slice(i, tab);
        const row = Number(tsv.slice(tab + 1, nl));
        map.set(concept, row);
        rowConcepts[row] = concept;
        i = nl + 1;
      }

      // Pre-compute L2 norms per row so cosine is one dot + two scalar
      // divides. ~30s once at startup, saves runtime per-query work.
      const dim = meta.dim;
      const norms = new Float32Array(meta.rows);
      for (let r = 0; r < meta.rows; r += 1) {
        const off = r * dim;
        let sum = 0;
        for (let d = 0; d < dim; d += 1) {
          const v = matrix[off + d];
          sum += v * v;
        }
        norms[r] = Math.sqrt(sum) || 1;
      }

      nbIndex = {
        dim,
        rows: meta.rows,
        conceptToRow: map,
        rowConcepts,
        matrix,
        norms,
      };
    } catch {
      nbIndex = null;
      return undefined;
    }
  }
  return nbIndex;
}

export interface NumberbatchNeighbor {
  concept: string;
  similarity: number;
}

/**
 * In-memory k-nearest-neighbor search over the Numberbatch matrix.
 *
 * Performance: for 9.16M rows × 300 dim int8, scanning the whole matrix is
 * ~2.7 GB of sequential memory access. On modern CPUs with the matrix loaded
 * (~25 GB/s memory bandwidth), a full scan takes ~100ms. The dot product is
 * the inner loop — pre-computed L2 norms turn cosine into one dot + one
 * scalar divide per row.
 */
export function localNumberbatchNeighbors(
  word: string,
  language: string,
  limit: number,
  opts: { targetLanguage?: string } = {}
): NumberbatchNeighbor[] | undefined {
  const nb = loadNumberbatch();
  if (!nb) return undefined;
  const concept = `/c/${language}/${normalizeWord(word)}`;
  const seedRow = nb.conceptToRow.get(concept);
  if (seedRow === undefined) return [];

  const dim = nb.dim;
  const matrix = nb.matrix;
  const norms = nb.norms;
  const rowConcepts = nb.rowConcepts;
  const seedNorm = norms[seedRow];
  const seedOff = seedRow * dim;
  const langPrefix = opts.targetLanguage ? `/c/${opts.targetLanguage}/` : null;

  // Min-heap of size `limit` keyed by similarity. We use a flat array as the
  // heap and rebalance in O(log limit) on insert.
  const sims = new Float32Array(limit);
  const rows = new Int32Array(limit);
  let heapSize = 0;
  let heapMin = -Infinity;

  for (let r = 0; r < nb.rows; r += 1) {
    if (r === seedRow) continue;
    if (langPrefix) {
      // Cheap pre-filter via row->concept lookup.
      const c = rowConcepts[r];
      if (!c || !c.startsWith(langPrefix)) continue;
    }
    const off = r * dim;
    let dot = 0;
    for (let d = 0; d < dim; d += 1) {
      dot += matrix[seedOff + d] * matrix[off + d];
    }
    const sim = dot / (seedNorm * norms[r]);
    if (heapSize < limit) {
      sims[heapSize] = sim;
      rows[heapSize] = r;
      heapSize += 1;
      if (heapSize === limit) {
        // Build initial min-heap.
        for (let i = (limit >> 1) - 1; i >= 0; i -= 1) heapifyDown(sims, rows, i, limit);
        heapMin = sims[0];
      }
    } else if (sim > heapMin) {
      sims[0] = sim;
      rows[0] = r;
      heapifyDown(sims, rows, 0, limit);
      heapMin = sims[0];
    }
  }

  // Sort the result heap descending by similarity.
  const result: NumberbatchNeighbor[] = new Array(heapSize);
  for (let i = 0; i < heapSize; i += 1) {
    result[i] = { concept: rowConcepts[rows[i]] ?? "", similarity: sims[i] };
  }
  result.sort((a, b) => b.similarity - a.similarity);
  return result;
}

function heapifyDown(
  sims: Float32Array,
  rows: Int32Array,
  i: number,
  n: number
): void {
  while (true) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    let smallest = i;
    if (l < n && sims[l] < sims[smallest]) smallest = l;
    if (r < n && sims[r] < sims[smallest]) smallest = r;
    if (smallest === i) return;
    const ts = sims[i];
    sims[i] = sims[smallest];
    sims[smallest] = ts;
    const tr = rows[i];
    rows[i] = rows[smallest];
    rows[smallest] = tr;
    i = smallest;
  }
}
