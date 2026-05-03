import { z } from "zod";
import { responseCache } from "../cache.js";

export const adminTools = [
  {
    name: "dictionary_cache_stats",
    description:
      "Get statistics about the in-memory response cache: hits, misses, size, configuration. Useful for debugging or measuring cache effectiveness in a session.",
    inputSchema: z.object({}),
    handler: async () => {
      return responseCache.stats();
    },
  },
  {
    name: "dictionary_cache_clear",
    description:
      "Clear the in-memory response cache. Useful when you need to force fresh lookups (e.g. after a Wiktionary edit you want to see).",
    inputSchema: z.object({}),
    handler: async () => {
      const before = responseCache.stats();
      responseCache.clear();
      return { cleared: true, entriesEvicted: before.size };
    },
  },
];
