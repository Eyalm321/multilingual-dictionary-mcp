import { z } from "zod";
import {
  localRhymes,
  localSoundsLike,
  localSpelledLike,
  localSuggest,
  localNumberbatchNeighbors,
} from "../data/local-store.js";

function requireLocal<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(
      `${what} requires the offline data. Run with MDM_PROFILE=medium or full.`
    );
  }
  return value;
}

export const englishTools = [
  {
    name: "dictionary_rhymes",
    description:
      "Find words that rhyme with the input word. English only — backed by the offline CMU Pronouncing Dictionary.",
    inputSchema: z.object({
      word: z.string(),
      limit: z.number().int().min(1).max(1000).default(50),
      perfect: z
        .boolean()
        .default(true)
        .describe("Perfect rhymes (true) vs near rhymes (false)"),
    }),
    handler: async (args: { word: string; limit?: number; perfect?: boolean }) => {
      const limit = args.limit ?? 50;
      const perfect = args.perfect !== false;
      return requireLocal(localRhymes(args.word, perfect, limit), "dictionary_rhymes");
    },
  },
  {
    name: "dictionary_sounds_like",
    description:
      "Find English words that sound similar to the input (homophones / soundalikes) via offline CMU dict.",
    inputSchema: z.object({
      word: z.string(),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; limit?: number }) =>
      requireLocal(localSoundsLike(args.word, args.limit ?? 50), "dictionary_sounds_like"),
  },
  {
    name: "dictionary_means_like",
    description:
      "Find words/phrases meaning approximately the same as the input via offline Numberbatch embedding cosine. Multilingual — works in any of the 78 languages Numberbatch covers.",
    inputSchema: z.object({
      query: z.string().describe("The word or phrase"),
      language: z
        .string()
        .default("en")
        .describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { query: string; language?: string; limit?: number }) => {
      const lang = args.language ?? "en";
      const limit = args.limit ?? 50;
      const neighbors = requireLocal(
        localNumberbatchNeighbors(args.query, lang, limit),
        "dictionary_means_like"
      );
      return neighbors.map((n) => ({
        word: n.concept.split("/").pop()?.replace(/_/g, " ") ?? n.concept,
        language: n.concept.split("/")[2] ?? "",
        score: Math.round(n.similarity * 100000),
      }));
    },
  },
  {
    name: "dictionary_spelled_like",
    description:
      "Find English words matching a spelling pattern via offline CMU dict. '?' = any single letter, '*' = any zero+ letters. Useful for crosswords.",
    inputSchema: z.object({
      pattern: z.string().describe("Spelling pattern (e.g. 'h?llo', 'hel*', 'p*p')"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { pattern: string; limit?: number }) =>
      requireLocal(
        localSpelledLike(args.pattern, args.limit ?? 50),
        "dictionary_spelled_like"
      ),
  },
  {
    name: "dictionary_suggest",
    description:
      "Get autocomplete suggestions for a partial English word via offline CMU dict (shortest matches first).",
    inputSchema: z.object({
      prefix: z.string(),
      limit: z.number().int().min(1).max(1000).default(10),
    }),
    handler: async (args: { prefix: string; limit?: number }) =>
      requireLocal(localSuggest(args.prefix, args.limit ?? 10), "dictionary_suggest"),
  },
];
