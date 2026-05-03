import { z } from "zod";
import { datamuseRequest } from "../client.js";
import { localRhymes, localSoundsLike } from "../data/local-store.js";

interface DatamuseWord {
  word: string;
  score?: number;
  numSyllables?: number;
  tags?: string[];
  defs?: string[];
}

export const englishTools = [
  {
    name: "dictionary_rhymes",
    description:
      "Find words that rhyme with the input word (English only). Powered by Datamuse.",
    inputSchema: z.object({
      word: z.string().describe("The word to rhyme with"),
      limit: z.number().int().min(1).max(1000).default(50),
      perfect: z
        .boolean()
        .default(true)
        .describe("Perfect rhymes (true) vs near/approximate rhymes (false)"),
    }),
    handler: async (args: { word: string; limit?: number; perfect?: boolean }) => {
      const limit = args.limit ?? 50;
      const perfect = args.perfect !== false;
      const local = localRhymes(args.word, perfect, limit);
      if (local !== undefined) return local;
      const params = {
        [perfect ? "rel_rhy" : "rel_nry"]: args.word,
        max: limit,
      };
      return datamuseRequest<DatamuseWord[]>("/words", params);
    },
  },
  {
    name: "dictionary_sounds_like",
    description:
      "Find English words that sound similar to the input word (homophones / soundalikes). Powered by Datamuse.",
    inputSchema: z.object({
      word: z.string().describe("The word to find soundalikes for"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; limit?: number }) => {
      const limit = args.limit ?? 50;
      const local = localSoundsLike(args.word, limit);
      if (local !== undefined) return local;
      return datamuseRequest<DatamuseWord[]>("/words", {
        sl: args.word,
        max: limit,
      });
    },
  },
  {
    name: "dictionary_means_like",
    description:
      "Find English words/phrases meaning approximately the same as the input. Powered by Datamuse's ML-based 'ml' parameter -- broader than strict synonyms.",
    inputSchema: z.object({
      query: z.string().describe("The word or phrase"),
      limit: z.number().int().min(1).max(1000).default(50),
      includeDefinitions: z
        .boolean()
        .default(false)
        .describe("Include short definitions in results"),
    }),
    handler: async (args: {
      query: string;
      limit?: number;
      includeDefinitions?: boolean;
    }) => {
      const params: Record<string, string | number> = {
        ml: args.query,
        max: args.limit ?? 50,
      };
      if (args.includeDefinitions) params.md = "d";
      return datamuseRequest<DatamuseWord[]>("/words", params);
    },
  },
  {
    name: "dictionary_spelled_like",
    description:
      "Find English words matching a spelling pattern. Wildcards: '?' for any single letter, '*' for any zero+ letters. Useful for crosswords.",
    inputSchema: z.object({
      pattern: z
        .string()
        .describe("Spelling pattern (e.g. 'h?llo', 'hel*', 'p*p')"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { pattern: string; limit?: number }) => {
      return datamuseRequest<DatamuseWord[]>("/words", {
        sp: args.pattern,
        max: args.limit ?? 50,
      });
    },
  },
  {
    name: "dictionary_suggest",
    description:
      "Get autocomplete suggestions for a partial English word. Powered by Datamuse /sug endpoint.",
    inputSchema: z.object({
      prefix: z.string().describe("Partial word to complete"),
      limit: z.number().int().min(1).max(1000).default(10),
    }),
    handler: async (args: { prefix: string; limit?: number }) => {
      return datamuseRequest<DatamuseWord[]>("/sug", {
        s: args.prefix,
        max: args.limit ?? 10,
      });
    },
  },
  {
    name: "dictionary_triggers",
    description:
      "Find words 'triggered by' another word -- statistically associated terms in text (English). E.g. cow -> milk, farm, beef.",
    inputSchema: z.object({
      word: z.string().describe("The trigger word"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; limit?: number }) => {
      return datamuseRequest<DatamuseWord[]>("/words", {
        rel_trg: args.word,
        max: args.limit ?? 50,
      });
    },
  },
  {
    name: "dictionary_follows",
    description:
      "Find English words that commonly follow another word in text. E.g. 'drink' -> 'coffee, beer, water'.",
    inputSchema: z.object({
      word: z.string().describe("The preceding word"),
      hint: z
        .string()
        .optional()
        .describe("Optional topic hint to bias results toward"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; hint?: string; limit?: number }) => {
      const params: Record<string, string | number> = {
        lc: args.word,
        max: args.limit ?? 50,
      };
      if (args.hint) params.topics = args.hint;
      return datamuseRequest<DatamuseWord[]>("/words", params);
    },
  },
  {
    name: "dictionary_precedes",
    description:
      "Find English words that commonly precede another word in text. E.g. 'audience' -> 'captive, target, live'.",
    inputSchema: z.object({
      word: z.string().describe("The following word"),
      hint: z
        .string()
        .optional()
        .describe("Optional topic hint to bias results toward"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; hint?: string; limit?: number }) => {
      const params: Record<string, string | number> = {
        rc: args.word,
        max: args.limit ?? 50,
      };
      if (args.hint) params.topics = args.hint;
      return datamuseRequest<DatamuseWord[]>("/words", params);
    },
  },
];
