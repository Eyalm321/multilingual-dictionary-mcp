import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { definitionTools } from "../tools/definitions.js";

function findTool(name: string) {
  const tool = definitionTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("definition tools", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("dictionary_lookup hits Wiktionary REST definition endpoint", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    const tool = findTool("dictionary_lookup");
    await tool.handler({ word: "dog" });

    const url = new URL(capturedUrl);
    expect(url.origin).toBe("https://en.wiktionary.org");
    expect(url.pathname).toBe("/api/rest_v1/page/definition/dog");
  });

  it("dictionary_lookup URL-encodes special characters", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    const tool = findTool("dictionary_lookup");
    await tool.handler({ word: "café" });

    expect(capturedUrl).toContain("%C3%A9");
  });

  it("dictionary_lookup strips HTML and groups by language", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          en: [
            {
              partOfSpeech: "Noun",
              language: "English",
              definitions: [
                {
                  definition: "A <strong>domesticated</strong> carnivorous mammal.",
                  examples: ["The <em>dog</em> barked."],
                },
              ],
            },
          ],
          es: [
            {
              partOfSpeech: "Sustantivo",
              language: "Spanish",
              definitions: [{ definition: "Un animal." }],
            },
          ],
        }),
    });

    const tool = findTool("dictionary_lookup");
    const result = (await tool.handler({ word: "dog" })) as Record<string, any>;

    expect(result.en[0].definitions[0].definition).toBe(
      "A domesticated carnivorous mammal."
    );
    expect(result.en[0].definitions[0].examples[0]).toBe("The dog barked.");
    expect(result.es).toBeDefined();
  });

  it("dictionary_lookup language filter excludes other languages", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          en: [{ partOfSpeech: "Noun", language: "English", definitions: [] }],
          es: [{ partOfSpeech: "Sustantivo", language: "Spanish", definitions: [] }],
        }),
    });

    const tool = findTool("dictionary_lookup");
    const result = (await tool.handler({ word: "dog", language: "es" })) as Record<
      string,
      any
    >;

    expect(result.en).toBeUndefined();
    expect(result.es).toBeDefined();
  });

  it("dictionary_summary routes to selected wiktionary edition", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ title: "perro" }),
      });
    });

    const tool = findTool("dictionary_summary");
    await tool.handler({ word: "perro", wiktionaryLanguage: "es" });

    const url = new URL(capturedUrl);
    expect(url.origin).toBe("https://es.wiktionary.org");
    expect(url.pathname).toBe("/api/rest_v1/page/summary/perro");
  });

  it("dictionary_etymology calls action=parse for wikitext", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ parse: { wikitext: "no etymology section" } }),
      });
    });

    const tool = findTool("dictionary_etymology");
    await tool.handler({ word: "dog" });

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe("/w/api.php");
    expect(url.searchParams.get("action")).toBe("parse");
    expect(url.searchParams.get("page")).toBe("dog");
    expect(url.searchParams.get("prop")).toBe("wikitext");
  });

  it("dictionary_etymology extracts and cleans the etymology section", async () => {
    const wikitext = `
==English==

===Etymology===
From {{inh|en|enm|dogge}}, from {{inh|en|ang|docga}}.

===Pronunciation===
* {{IPA|en|/dɒɡ/}}

===Noun===
# A '''domesticated''' [[mammal]].
`;
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ parse: { wikitext } }),
    });

    const tool = findTool("dictionary_etymology");
    const result = (await tool.handler({ word: "dog" })) as {
      etymology: string | null;
    };

    expect(result.etymology).toBeTruthy();
    expect(result.etymology).toContain("From");
    expect(result.etymology).not.toContain("{{");
    expect(result.etymology).not.toContain("==");
  });

  it("dictionary_etymology returns null when no section found", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ parse: { wikitext: "==English==\n===Noun===\n# def" } }),
    });

    const tool = findTool("dictionary_etymology");
    const result = (await tool.handler({ word: "test" })) as {
      etymology: string | null;
    };

    expect(result.etymology).toBeNull();
  });

  it("dictionary_search uses opensearch action", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(["happ", ["happy", "happen"], ["", ""], ["", ""]]),
      });
    });

    const tool = findTool("dictionary_search");
    const result = (await tool.handler({ query: "happ", limit: 5 })) as Array<{
      title: string;
    }>;

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("action")).toBe("opensearch");
    expect(url.searchParams.get("search")).toBe("happ");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(result.length).toBe(2);
    expect(result[0].title).toBe("happy");
  });

  it("dictionary_random uses list=random query", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ query: { random: [{ id: 1, title: "test" }] } }),
      });
    });

    const tool = findTool("dictionary_random");
    await tool.handler({ wiktionaryLanguage: "fr" });

    const url = new URL(capturedUrl);
    expect(url.origin).toBe("https://fr.wiktionary.org");
    expect(url.searchParams.get("action")).toBe("query");
    expect(url.searchParams.get("list")).toBe("random");
    expect(url.searchParams.get("rnnamespace")).toBe("0");
  });

  it("throws on Wiktionary API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });

    const tool = findTool("dictionary_lookup");
    await expect(tool.handler({ word: "missing" })).rejects.toThrow(/404/);
  });
});
