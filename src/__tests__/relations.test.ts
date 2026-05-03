import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { relationTools } from "../tools/relations.js";

function findTool(name: string) {
  const tool = relationTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("relation tools", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("dictionary_synonyms calls /query with rel=/r/Synonym", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ edges: [] }),
      });
    });

    const tool = findTool("dictionary_synonyms");
    await tool.handler({ word: "happy", language: "en", limit: 10 });

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe("/query");
    expect(url.searchParams.get("rel")).toBe("/r/Synonym");
    expect(url.searchParams.get("node")).toBe("/c/en/happy");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("dictionary_antonyms calls /query with rel=/r/Antonym", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ edges: [] }),
      });
    });

    const tool = findTool("dictionary_antonyms");
    await tool.handler({ word: "happy", language: "en" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("rel")).toBe("/r/Antonym");
  });

  it("dictionary_hypernyms uses 'start' direction (IsA from this word)", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ edges: [] }),
      });
    });

    const tool = findTool("dictionary_hypernyms");
    await tool.handler({ word: "dog", language: "en" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("rel")).toBe("/r/IsA");
    expect(url.searchParams.get("start")).toBe("/c/en/dog");
    expect(url.searchParams.has("end")).toBe(false);
  });

  it("dictionary_hyponyms uses 'end' direction (IsA into this word)", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ edges: [] }),
      });
    });

    const tool = findTool("dictionary_hyponyms");
    await tool.handler({ word: "dog", language: "en" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("rel")).toBe("/r/IsA");
    expect(url.searchParams.get("end")).toBe("/c/en/dog");
    expect(url.searchParams.has("start")).toBe(false);
  });

  it("dictionary_translate adds 'other' filter when targetLanguage given", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ edges: [] }),
      });
    });

    const tool = findTool("dictionary_translate");
    await tool.handler({ word: "dog", language: "en", targetLanguage: "es" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("node")).toBe("/c/en/dog");
    expect(url.searchParams.get("other")).toBe("/c/es");
  });

  it("dictionary_translate filters out same-language results", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          edges: [
            {
              "@id": "/a/1",
              rel: { "@id": "/r/Synonym", label: "synonym" },
              start: {
                "@id": "/c/en/dog",
                label: "dog",
                language: "en",
                term: "dog",
              },
              end: {
                "@id": "/c/es/perro",
                label: "perro",
                language: "es",
                term: "perro",
              },
              weight: 1,
            },
            {
              "@id": "/a/2",
              rel: { "@id": "/r/Synonym", label: "synonym" },
              start: {
                "@id": "/c/en/dog",
                label: "dog",
                language: "en",
                term: "dog",
              },
              end: {
                "@id": "/c/en/canine",
                label: "canine",
                language: "en",
                term: "canine",
              },
              weight: 1,
            },
          ],
        }),
    });

    const tool = findTool("dictionary_translate");
    const result = (await tool.handler({
      word: "dog",
      language: "en",
    })) as Array<{ targetLanguage: string }>;

    expect(result.length).toBe(1);
    expect(result[0].targetLanguage).toBe("es");
  });

  it("dictionary_all_relations uses /c/<lang>/<word> path directly", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ edges: [] }),
      });
    });

    const tool = findTool("dictionary_all_relations");
    await tool.handler({ word: "happy", language: "en", limit: 25 });

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe("/c/en/happy");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("default language is 'en' when omitted", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ edges: [] }),
      });
    });

    const tool = findTool("dictionary_synonyms");
    await tool.handler({ word: "test" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("node")).toBe("/c/en/test");
  });

  it("non-English language codes route through correctly", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ edges: [] }),
      });
    });

    const tool = findTool("dictionary_synonyms");
    await tool.handler({ word: "perro", language: "es" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("node")).toBe("/c/es/perro");
  });

  it("summarized edges include relation, weight, and target language", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          edges: [
            {
              "@id": "/a/1",
              rel: { "@id": "/r/Synonym", label: "synonym" },
              start: {
                "@id": "/c/en/happy",
                label: "happy",
                language: "en",
                term: "happy",
              },
              end: {
                "@id": "/c/en/joyful",
                label: "joyful",
                language: "en",
                term: "joyful",
              },
              weight: 2.5,
              surfaceText: "[[happy]] is similar to [[joyful]]",
            },
          ],
        }),
    });

    const tool = findTool("dictionary_synonyms");
    const result = (await tool.handler({
      word: "happy",
      language: "en",
    })) as Array<{
      relation: string;
      weight: number;
      target: string;
      surfaceText?: string;
    }>;

    expect(result[0].relation).toBe("synonym");
    expect(result[0].weight).toBe(2.5);
    expect(result[0].target).toBe("joyful");
    expect(result[0].surfaceText).toContain("similar");
  });
});
