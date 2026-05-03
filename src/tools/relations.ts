import { z } from "zod";
import { conceptnetRequest, conceptnetUri } from "../client.js";
import { localConceptNetEdges, LocalEdge } from "../data/local-store.js";

interface ConceptNetEdge {
  "@id": string;
  rel: { "@id": string; label?: string };
  start: { "@id": string; label?: string; language?: string; term?: string };
  end: { "@id": string; label?: string; language?: string; term?: string };
  weight: number;
  surfaceText?: string | null;
}

interface ConceptNetResponse {
  "@id": string;
  edges: ConceptNetEdge[];
  view?: { nextPage?: string; previousPage?: string };
}

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

function summarizeEdge(
  edge: ConceptNetEdge,
  queryWord: string,
  queryLang: string
): RelationResult {
  const startTerm = edge.start.label || edge.start.term || edge.start["@id"];
  const endTerm = edge.end.label || edge.end.term || edge.end["@id"];
  const startLang = edge.start.language || "";
  const endLang = edge.end.language || "";

  const queryIsStart =
    edge.start.label?.toLowerCase() === queryWord.toLowerCase() ||
    startLang === queryLang;

  return {
    word: queryWord,
    language: queryLang,
    relation: edge.rel.label || edge.rel["@id"].replace("/r/", ""),
    weight: edge.weight,
    source: queryIsStart ? startTerm : endTerm,
    target: queryIsStart ? endTerm : startTerm,
    targetLanguage: queryIsStart ? endLang : startLang,
    surfaceText: edge.surfaceText || undefined,
  };
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

async function fetchEdges(
  word: string,
  language: string,
  rel: string,
  limit: number,
  direction: "start" | "end" | "any" = "any"
): Promise<RelationResult[]> {
  const local = localConceptNetEdges({ word, language, rel, direction, limit });
  if (local !== undefined) {
    return local.map((e) => localEdgeToResult(e, word, language));
  }

  const params: Record<string, string | number> = {
    rel: `/r/${rel}`,
    limit,
  };
  const node = conceptnetUri(word, language);
  if (direction === "start") {
    params.start = node;
  } else if (direction === "end") {
    params.end = node;
  } else {
    params.node = node;
  }
  const data = await conceptnetRequest<ConceptNetResponse>("/query", params);
  return (data.edges || []).map((edge) => summarizeEdge(edge, word, language));
}

export const relationTools = [
  {
    name: "dictionary_synonyms",
    description:
      "Get synonyms for a word in any language using ConceptNet. Returns words/phrases with similar meaning, with relation weights. Works for English, Spanish, French, German, Italian, Russian, Hebrew, Arabic, Latin, Chinese, Japanese, and 70+ more languages.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z
        .string()
        .default("en")
        .describe("ISO 639-1 language code (e.g. 'en', 'es', 'fr', 'it', 'he', 'ar', 'la', 'zh', 'ja')"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(50)
        .describe("Maximum number of results to return"),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "Synonym",
        args.limit ?? 50
      );
    },
  },
  {
    name: "dictionary_antonyms",
    description:
      "Get antonyms (opposites) for a word in any language using ConceptNet. Works across 80+ languages.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "Antonym",
        args.limit ?? 50
      );
    },
  },
  {
    name: "dictionary_related",
    description:
      "Get semantically related words for a word in any language using ConceptNet's RelatedTo edges. Useful for finding loosely associated terms (e.g. coffee -> espresso, cafe, brew).",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "RelatedTo",
        args.limit ?? 50
      );
    },
  },
  {
    name: "dictionary_hypernyms",
    description:
      "Get hypernyms (broader/parent concepts) for a word using ConceptNet's IsA relation. E.g. dog -> mammal, animal.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "IsA",
        args.limit ?? 50,
        "start"
      );
    },
  },
  {
    name: "dictionary_hyponyms",
    description:
      "Get hyponyms (narrower/child concepts) for a word using reverse ConceptNet IsA relations. E.g. dog -> poodle, terrier.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "IsA",
        args.limit ?? 50,
        "end"
      );
    },
  },
  {
    name: "dictionary_meronyms",
    description:
      "Get meronyms (parts/components) for a word using ConceptNet's PartOf relation. E.g. car -> wheel, engine.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "PartOf",
        args.limit ?? 50,
        "end"
      );
    },
  },
  {
    name: "dictionary_holonyms",
    description:
      "Get holonyms (wholes that contain this word) for a word using reverse PartOf relations. E.g. wheel -> car, bicycle.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "PartOf",
        args.limit ?? 50,
        "start"
      );
    },
  },
  {
    name: "dictionary_derived_from",
    description:
      "Get words this word is derived from (etymology relations) using ConceptNet's DerivedFrom relation.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "DerivedFrom",
        args.limit ?? 50,
        "start"
      );
    },
  },
  {
    name: "dictionary_etymologically_related",
    description:
      "Get etymologically related words (shared roots, cognates across languages) using ConceptNet.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "EtymologicallyRelatedTo",
        args.limit ?? 50
      );
    },
  },
  {
    name: "dictionary_used_for",
    description:
      "Get UsedFor relations -- the typical purposes or uses of a word/concept (e.g. knife -> cutting).",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "UsedFor",
        args.limit ?? 50,
        "start"
      );
    },
  },
  {
    name: "dictionary_capable_of",
    description:
      "Get CapableOf relations -- typical actions or capabilities of a thing (e.g. dog -> bark, run).",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "CapableOf",
        args.limit ?? 50,
        "start"
      );
    },
  },
  {
    name: "dictionary_at_location",
    description:
      "Get AtLocation relations -- typical locations where something is found (e.g. book -> library).",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      return fetchEdges(
        args.word,
        args.language ?? "en",
        "AtLocation",
        args.limit ?? 50,
        "start"
      );
    },
  },
  {
    name: "dictionary_translate",
    description:
      "Get translations for a word into other languages using ConceptNet's cross-lingual links. Returns the same concept expressed in different languages.",
    inputSchema: z.object({
      word: z.string().describe("The word to translate"),
      language: z.string().default("en").describe("Source language ISO 639-1 code"),
      targetLanguage: z
        .string()
        .optional()
        .describe(
          "Target language ISO 639-1 code (omit to get translations in all available languages)"
        ),
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
      if (local !== undefined) {
        return local
          .map((e) => localEdgeToResult(e, args.word, lang))
          .filter((r) => r.targetLanguage && r.targetLanguage !== lang);
      }

      const node = conceptnetUri(args.word, lang);
      const params: Record<string, string | number> = {
        node,
        rel: "/r/Synonym",
        limit,
      };
      if (args.targetLanguage) {
        params.other = `/c/${args.targetLanguage}`;
      }
      const data = await conceptnetRequest<ConceptNetResponse>("/query", params);
      return (data.edges || [])
        .map((edge) => summarizeEdge(edge, args.word, lang))
        .filter((r) => r.targetLanguage && r.targetLanguage !== lang);
    },
  },
  {
    name: "dictionary_all_relations",
    description:
      "Get all relations (synonyms, antonyms, hypernyms, etc.) for a word in one call using ConceptNet. Useful for exploring a word's full semantic neighborhood.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z.string().default("en").describe("ISO 639-1 language code"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .describe("Maximum number of edges to return"),
    }),
    handler: async (args: { word: string; language?: string; limit?: number }) => {
      const lang = args.language ?? "en";
      const data = await conceptnetRequest<ConceptNetResponse>(
        conceptnetUri(args.word, lang),
        { limit: args.limit ?? 100 }
      );
      return (data.edges || []).map((edge) => summarizeEdge(edge, args.word, lang));
    },
  },
];
