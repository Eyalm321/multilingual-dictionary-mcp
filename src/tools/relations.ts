import { z } from "zod";
import {
  localConceptNetEdges,
  LocalEdge,
  localNumberbatchNeighbors,
} from "../data/local-store.js";

interface RelationResult {
  word: string;
  language: string;
  relation: string;
  weight: number;
  source: string;
  target: string;
  targetLanguage: string;
  surfaceText?: string;
}

function localEdgeToResult(
  edge: LocalEdge,
  queryWord: string,
  queryLang: string
): RelationResult {
  const queryIsStart =
    edge.startLang === queryLang &&
    edge.startLabel.toLowerCase() === queryWord.toLowerCase();
  return {
    word: queryWord,
    language: queryLang,
    relation: edge.rel,
    weight: edge.weight,
    source: queryIsStart ? edge.startLabel : edge.endLabel,
    target: queryIsStart ? edge.endLabel : edge.startLabel,
    targetLanguage: queryIsStart ? edge.endLang : edge.startLang,
    surfaceText: edge.surfaceText || undefined,
  };
}

function fetchRelation(
  word: string,
  language: string,
  rel: string,
  limit: number,
  direction: "start" | "end" | "any" = "any"
): RelationResult[] {
  const local = localConceptNetEdges({ word, language, rel, direction, limit });
  if (local === undefined) {
    throw new Error(
      "ConceptNet relation lookup requires the offline data. The bundle should download automatically from the CDN on first start."
    );
  }
  return local.map((e) => localEdgeToResult(e, word, language));
}

export const relationTools = [
  {
    name: "dictionary_synonyms",
    description:
      "Get synonyms for a word in any language using the offline ConceptNet 5.7 SQLite (24M edges, 80+ languages).",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z
        .string()
        .default("en")
        .describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "Synonym", args.limit ?? 50),
  },
  {
    name: "dictionary_antonyms",
    description: "Get antonyms (opposites) for a word in any language using offline ConceptNet.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "Antonym", args.limit ?? 50),
  },
  {
    name: "dictionary_related",
    description:
      "Get semantically related words via Numberbatch embedding cosine (9.16M concepts × 300d) — much denser than ConceptNet RelatedTo edges. Falls back to ConceptNet RelatedTo when the embeddings aren't installed.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      const lang = args.language ?? "en";
      const limit = args.limit ?? 50;
      const neighbors = localNumberbatchNeighbors(args.word, lang, limit);
      if (neighbors !== undefined && neighbors.length > 0) {
        return neighbors.map((n) => ({
          word: args.word,
          language: lang,
          relation: "EmbeddingNeighbor",
          weight: n.similarity,
          source: args.word,
          target: n.concept.split("/").pop()?.replace(/_/g, " ") ?? n.concept,
          targetLanguage: n.concept.split("/")[2] ?? "",
        }));
      }
      return fetchRelation(args.word, lang, "RelatedTo", limit);
    },
  },
  {
    name: "dictionary_semantic_neighbors",
    description:
      "Embedding-based nearest neighbors via Numberbatch. Returns words from the same OR a different language, sorted by cosine similarity. Multilingual (78 languages).",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en").describe("Source language ISO 639-1 code"),
      targetLanguage: z
        .string()
        .optional()
        .describe(
          "If set, only return neighbors in this language (cross-lingual semantic search)."
        ),
      limit: z.number().int().min(1).max(1000).default(20),
    }),
    handler: async (args: {
      word: string;
      language?: string;
      targetLanguage?: string;
      limit?: number;
    }) => {
      const lang = args.language ?? "en";
      const limit = args.limit ?? 20;
      const neighbors = localNumberbatchNeighbors(args.word, lang, limit, {
        targetLanguage: args.targetLanguage,
      });
      if (neighbors === undefined) {
        throw new Error(
          "Numberbatch embeddings not installed. The bundle should download automatically on server start."
        );
      }
      return neighbors.map((n) => ({
        concept: n.concept,
        word: n.concept.split("/").pop()?.replace(/_/g, " ") ?? n.concept,
        language: n.concept.split("/")[2] ?? "",
        similarity: n.similarity,
      }));
    },
  },
  {
    name: "dictionary_hypernyms",
    description: "Hypernyms (broader concepts) via offline ConceptNet IsA. E.g. dog -> mammal.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "IsA", args.limit ?? 50, "start"),
  },
  {
    name: "dictionary_hyponyms",
    description: "Hyponyms (narrower concepts) via offline ConceptNet IsA. E.g. dog -> poodle.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "IsA", args.limit ?? 50, "end"),
  },
  {
    name: "dictionary_meronyms",
    description: "Meronyms (parts/components) via offline ConceptNet PartOf. E.g. car -> wheel.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "PartOf", args.limit ?? 50, "end"),
  },
  {
    name: "dictionary_holonyms",
    description: "Holonyms (wholes that contain this word) via offline ConceptNet reverse PartOf.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "PartOf", args.limit ?? 50, "start"),
  },
  {
    name: "dictionary_derived_from",
    description: "Derivation relations via offline ConceptNet DerivedFrom.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "DerivedFrom", args.limit ?? 50, "start"),
  },
  {
    name: "dictionary_etymologically_related",
    description: "Etymologically related words / cognates via offline ConceptNet EtymologicallyRelatedTo.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "EtymologicallyRelatedTo", args.limit ?? 50),
  },
  {
    name: "dictionary_used_for",
    description: "Typical uses (UsedFor) via offline ConceptNet. E.g. knife -> cutting.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "UsedFor", args.limit ?? 50, "start"),
  },
  {
    name: "dictionary_capable_of",
    description: "Typical actions (CapableOf) via offline ConceptNet. E.g. dog -> bark.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "CapableOf", args.limit ?? 50, "start"),
  },
  {
    name: "dictionary_at_location",
    description: "Typical locations (AtLocation) via offline ConceptNet. E.g. book -> library.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) =>
      fetchRelation(args.word, args.language ?? "en", "AtLocation", args.limit ?? 50, "start"),
  },
  {
    name: "dictionary_translate",
    description:
      "Translate a word to another language via offline ConceptNet's cross-lingual Synonym links. Returns the same concept expressed in different languages.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en").describe("Source language ISO 639-1 code"),
      targetLanguage: z
        .string()
        .optional()
        .describe("Target language ISO 639-1 code (omit for translations in all available languages)"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: {
      word: string;
      language?: string;
      targetLanguage?: string;
      limit?: number;
    }) => {
      const lang = args.language ?? "en";
      const limit = args.limit ?? 50;
      const local = localConceptNetEdges({
        word: args.word,
        language: lang,
        rel: "Synonym",
        direction: "any",
        otherLanguage: args.targetLanguage,
        limit,
      });
      if (local === undefined) {
        throw new Error(
          "dictionary_translate requires the offline ConceptNet data. The bundle should download automatically on server start."
        );
      }
      return local
        .map((e) => localEdgeToResult(e, args.word, lang))
        .filter((r) => r.targetLanguage && r.targetLanguage !== lang);
    },
  },
  {
    name: "dictionary_all_relations",
    description:
      "All edges (every relation type) for a word in one call from offline ConceptNet.",
    inputSchema: z.object({
      word: z.string(),
      language: z.string().default("en"),
      limit: z.number().int().min(1).max(1000).default(100),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      const lang = args.language ?? "en";
      const local = localConceptNetEdges({
        word: args.word,
        language: lang,
        direction: "any",
        limit: args.limit ?? 100,
      });
      if (local === undefined) {
        throw new Error(
          "dictionary_all_relations requires the offline ConceptNet data. The bundle should download automatically on server start."
        );
      }
      return local.map((e) => localEdgeToResult(e, args.word, lang));
    },
  },
];
