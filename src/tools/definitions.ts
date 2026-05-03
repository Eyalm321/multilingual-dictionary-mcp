import { z } from "zod";
import { wiktionaryRequest } from "../client.js";

interface WiktionaryDefinitionEntry {
  partOfSpeech: string;
  language: string;
  definitions: Array<{
    definition: string;
    examples?: string[];
    parsedExamples?: Array<{ example: string }>;
  }>;
}

interface WiktionaryDefinitionResponse {
  [languageCode: string]: WiktionaryDefinitionEntry[];
}

interface MediaWikiQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        extract?: string;
        revisions?: Array<{ slots?: { main?: { "*"?: string; content?: string } }; "*"?: string }>;
      }
    >;
  };
  parse?: {
    title?: string;
    text?: { "*": string } | string;
    wikitext?: { "*": string } | string;
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSection(wikitext: string, sectionName: string): string | undefined {
  const re = new RegExp(`={2,}\\s*${sectionName}\\s*={2,}`, "i");
  const match = re.exec(wikitext);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = wikitext.slice(start);
  const nextSection = /={2,}\s*[^=]+\s*={2,}/.exec(rest);
  return nextSection ? rest.slice(0, nextSection.index).trim() : rest.trim();
}

function cleanWikitext(wt: string): string {
  return wt
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/'''([^']+)'''/g, "$1")
    .replace(/''([^']+)''/g, "$1")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*[*#:]+\s*/gm, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

export const definitionTools = [
  {
    name: "dictionary_lookup",
    description:
      "Look up definitions for a word from Wiktionary. Uses the English Wiktionary REST API which includes entries for words in 4000+ languages. Returns part-of-speech, definitions grouped by language, and examples.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      language: z
        .string()
        .optional()
        .describe(
          "Filter results to a specific language ISO 639-1 code (e.g. 'en', 'es', 'la'). Omit to return entries for all languages."
        ),
    }),
    handler: async (args: { word: string; language?: string }) => {
      const data = await wiktionaryRequest<WiktionaryDefinitionResponse>(
        `/api/rest_v1/page/definition/${encodeURIComponent(args.word)}`
      );

      const cleaned: Record<string, unknown> = {};
      for (const [langCode, entries] of Object.entries(data)) {
        if (args.language && langCode !== args.language) continue;
        cleaned[langCode] = entries.map((entry) => ({
          partOfSpeech: entry.partOfSpeech,
          language: entry.language,
          definitions: entry.definitions.map((def) => ({
            definition: stripHtml(def.definition),
            examples: (def.parsedExamples ?? def.examples ?? []).map((ex) =>
              typeof ex === "string" ? stripHtml(ex) : stripHtml(ex.example)
            ),
          })),
        }));
      }

      return cleaned;
    },
  },
  {
    name: "dictionary_summary",
    description:
      "Get a brief summary/extract for a word from a specific language Wiktionary. Useful for getting a concise plain-text overview.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      wiktionaryLanguage: z
        .string()
        .default("en")
        .describe(
          "Which Wiktionary edition to query (e.g. 'en' for en.wiktionary.org, 'es' for es.wiktionary.org)"
        ),
    }),
    handler: async (args: { word: string; wiktionaryLanguage?: string }) => {
      const wikLang = args.wiktionaryLanguage ?? "en";
      const path = `/api/rest_v1/page/summary/${encodeURIComponent(args.word)}`;
      const customBase = `https://${wikLang}.wiktionary.org`;
      const res = await fetch(`${customBase}${path}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "multilingual-dictionary-mcp/0.1 (https://github.com/Eyalm321/multilingual-dictionary-mcp)",
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Wiktionary summary failed ${res.status}: ${text}`);
      }
      return res.json();
    },
  },
  {
    name: "dictionary_etymology",
    description:
      "Extract the etymology section for a word from Wiktionary. Returns the plain-text etymology from the requested Wiktionary edition.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      wiktionaryLanguage: z
        .string()
        .default("en")
        .describe("Which Wiktionary edition to query"),
    }),
    handler: async (args: { word: string; wiktionaryLanguage?: string }) => {
      const wikLang = args.wiktionaryLanguage ?? "en";
      const url = `https://${wikLang}.wiktionary.org/w/api.php`;
      const params = new URLSearchParams({
        action: "parse",
        page: args.word,
        prop: "wikitext",
        format: "json",
        formatversion: "2",
      });
      const res = await fetch(`${url}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "multilingual-dictionary-mcp/0.1 (https://github.com/Eyalm321/multilingual-dictionary-mcp)",
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Wiktionary etymology failed ${res.status}: ${text}`);
      }
      const data = (await res.json()) as MediaWikiQueryResponse;
      const wikitext =
        typeof data.parse?.wikitext === "string"
          ? data.parse?.wikitext
          : data.parse?.wikitext?.["*"];
      if (!wikitext) {
        return { word: args.word, etymology: null, note: "No wikitext returned" };
      }
      const section = extractSection(wikitext, "Etymology(?:\\s*\\d+)?");
      return {
        word: args.word,
        etymology: section ? cleanWikitext(section) : null,
      };
    },
  },
  {
    name: "dictionary_pronunciation",
    description:
      "Extract the Pronunciation section (typically containing IPA) for a word from Wiktionary.",
    inputSchema: z.object({
      word: z.string().describe("The word to look up"),
      wiktionaryLanguage: z
        .string()
        .default("en")
        .describe("Which Wiktionary edition to query"),
    }),
    handler: async (args: { word: string; wiktionaryLanguage?: string }) => {
      const wikLang = args.wiktionaryLanguage ?? "en";
      const url = `https://${wikLang}.wiktionary.org/w/api.php`;
      const params = new URLSearchParams({
        action: "parse",
        page: args.word,
        prop: "wikitext",
        format: "json",
        formatversion: "2",
      });
      const res = await fetch(`${url}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "multilingual-dictionary-mcp/0.1 (https://github.com/Eyalm321/multilingual-dictionary-mcp)",
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Wiktionary pronunciation failed ${res.status}: ${text}`);
      }
      const data = (await res.json()) as MediaWikiQueryResponse;
      const wikitext =
        typeof data.parse?.wikitext === "string"
          ? data.parse?.wikitext
          : data.parse?.wikitext?.["*"];
      if (!wikitext) {
        return { word: args.word, pronunciation: null };
      }
      const section = extractSection(wikitext, "Pronunciation");
      return {
        word: args.word,
        pronunciation: section ? cleanWikitext(section) : null,
      };
    },
  },
  {
    name: "dictionary_search",
    description:
      "Search a Wiktionary edition for pages matching a query. Useful when you don't know the exact spelling or want suggestions.",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      wiktionaryLanguage: z
        .string()
        .default("en")
        .describe("Which Wiktionary edition to search"),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    handler: async (args: {
      query: string;
      wiktionaryLanguage?: string;
      limit?: number;
    }) => {
      const wikLang = args.wiktionaryLanguage ?? "en";
      const url = `https://${wikLang}.wiktionary.org/w/api.php`;
      const params = new URLSearchParams({
        action: "opensearch",
        search: args.query,
        limit: String(args.limit ?? 10),
        format: "json",
        formatversion: "2",
      });
      const res = await fetch(`${url}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "multilingual-dictionary-mcp/0.1 (https://github.com/Eyalm321/multilingual-dictionary-mcp)",
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Wiktionary search failed ${res.status}: ${text}`);
      }
      const data = (await res.json()) as [string, string[], string[], string[]];
      const [, titles, descriptions, urls] = data;
      return titles.map((title, i) => ({
        title,
        description: descriptions[i] ?? "",
        url: urls[i] ?? "",
      }));
    },
  },
  {
    name: "dictionary_random",
    description:
      "Get a random word entry from a specific Wiktionary edition. Useful for vocabulary discovery in any language.",
    inputSchema: z.object({
      wiktionaryLanguage: z
        .string()
        .default("en")
        .describe("Which Wiktionary edition to query"),
    }),
    handler: async (args: { wiktionaryLanguage?: string }) => {
      const wikLang = args.wiktionaryLanguage ?? "en";
      const url = `https://${wikLang}.wiktionary.org/w/api.php`;
      const params = new URLSearchParams({
        action: "query",
        list: "random",
        rnnamespace: "0",
        rnlimit: "1",
        format: "json",
        formatversion: "2",
      });
      const res = await fetch(`${url}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "multilingual-dictionary-mcp/0.1 (https://github.com/Eyalm321/multilingual-dictionary-mcp)",
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Wiktionary random failed ${res.status}: ${text}`);
      }
      const data = (await res.json()) as {
        query?: { random?: Array<{ id: number; title: string }> };
      };
      return data.query?.random ?? [];
    },
  },
];
