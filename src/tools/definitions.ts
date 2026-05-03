import { z } from "zod";
import {
  localWiktextractByWord,
  localWiktextractSearch,
  localWiktextractRandom,
  WiktextractRow,
} from "../data/local-store.js";
import { dataInstallSummary } from "../data/installer.js";

interface SenseFromWiktextract {
  glosses?: string[];
  raw_glosses?: string[];
  examples?: Array<{ text?: string; type?: string }>;
  tags?: string[];
}

function shapeEntry(row: WiktextractRow) {
  let senses: SenseFromWiktextract[] = [];
  try {
    senses = JSON.parse(row.senses_json);
  } catch {
    senses = [];
  }
  return {
    word: row.word,
    language: row.lang_code,
    partOfSpeech: row.pos,
    ipa: row.ipa,
    etymology: row.etymology,
    definitions: senses.map((s) => ({
      definition: (s.glosses || s.raw_glosses || []).join("; "),
      tags: s.tags ?? [],
      examples: (s.examples || [])
        .map((e) => e.text)
        .filter((x): x is string => typeof x === "string"),
    })),
  };
}

function requireLocal<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(
      `${what} needs the offline Wiktextract data. Install state: ${dataInstallSummary()}. Use dictionary_status to track progress.`
    );
  }
  return value;
}

export const definitionTools = [
  {
    name: "dictionary_lookup",
    description:
      "Look up definitions for a word from the offline Wiktextract corpus (4,755 languages, 10.5M entries). Returns part-of-speech, definitions per sense, IPA, etymology, and translations grouped by language.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z
        .string()
        .optional()
        .describe(
          "Filter to a specific ISO 639-1 language code. Omit to return entries in all languages."
        ),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    handler: async (args: {
      word: string;
      language?: string;
      limit?: number;
    }) => {
      const rows = requireLocal(
        localWiktextractByWord(args.word, args.language, args.limit ?? 100),
        "dictionary_lookup"
      );
      const grouped: Record<string, ReturnType<typeof shapeEntry>[]> = {};
      for (const row of rows) {
        const lang = row.lang_code;
        if (!grouped[lang]) grouped[lang] = [];
        grouped[lang].push(shapeEntry(row));
      }
      return grouped;
    },
  },
  {
    name: "dictionary_summary",
    description:
      "Get a brief plain-text summary of a word's senses from the offline Wiktextract data. Concatenates the first definition of each sense.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z
        .string()
        .default("en")
        .describe("ISO 639-1 language code"),
    }),
    handler: async (args: { word: string; language?: string }) => {
      const lang = args.language ?? "en";
      const rows = requireLocal(
        localWiktextractByWord(args.word, lang, 5),
        "dictionary_summary"
      );
      if (!rows.length) return { word: args.word, language: lang, summary: null };
      const definitions: string[] = [];
      for (const row of rows) {
        const entry = shapeEntry(row);
        for (const def of entry.definitions) {
          if (def.definition) definitions.push(def.definition);
          if (definitions.length >= 5) break;
        }
        if (definitions.length >= 5) break;
      }
      return {
        word: args.word,
        language: lang,
        summary: definitions.join(" • "),
        partsOfSpeech: Array.from(new Set(rows.map((r) => r.pos).filter(Boolean))),
      };
    },
  },
  {
    name: "dictionary_etymology",
    description:
      "Return etymology text for a word from the offline Wiktextract corpus.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z
        .string()
        .default("en")
        .describe("ISO 639-1 language code"),
    }),
    handler: async (args: { word: string; language?: string }) => {
      const lang = args.language ?? "en";
      const rows = requireLocal(
        localWiktextractByWord(args.word, lang, 5),
        "dictionary_etymology"
      );
      const ety = rows.find((r) => r.etymology);
      return {
        word: args.word,
        language: lang,
        etymology: ety?.etymology ?? null,
      };
    },
  },
  {
    name: "dictionary_pronunciation",
    description:
      "Return IPA pronunciation(s) for a word from the offline Wiktextract corpus.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z
        .string()
        .default("en")
        .describe("ISO 639-1 language code"),
    }),
    handler: async (args: { word: string; language?: string }) => {
      const lang = args.language ?? "en";
      const rows = requireLocal(
        localWiktextractByWord(args.word, lang, 10),
        "dictionary_pronunciation"
      );
      const ipa = Array.from(
        new Set(
          rows
            .map((r) => r.ipa)
            .filter((x): x is string => typeof x === "string" && x.length > 0)
            .flatMap((s) => s.split(" | "))
        )
      );
      return {
        word: args.word,
        language: lang,
        pronunciation: ipa,
      };
    },
  },
  {
    name: "dictionary_search",
    description:
      "Prefix-search the offline Wiktextract corpus for words matching a query. Useful when you don't know the exact spelling.",
    inputSchema: z.object({
      query: z.string().describe("Prefix to search for"),
      language: z
        .string()
        .optional()
        .describe("Filter to a specific ISO 639-1 language code"),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    handler: async (args: {
      query: string;
      language?: string;
      limit?: number;
    }) => {
      return requireLocal(
        localWiktextractSearch(args.query, args.language, args.limit ?? 20),
        "dictionary_search"
      );
    },
  },
  {
    name: "dictionary_random",
    description:
      "Return a random word entry from the offline Wiktextract corpus, optionally filtered to a language.",
    inputSchema: z.object({
      language: z
        .string()
        .optional()
        .describe("Filter to a specific ISO 639-1 language code"),
    }),
    handler: async (args: { language?: string }) => {
      const row = requireLocal(
        localWiktextractRandom(args.language),
        "dictionary_random"
      );
      return row ? shapeEntry(row) : null;
    },
  },
];
