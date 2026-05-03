import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { englishTools } from "../tools/english.js";
import { responseCache } from "../cache.js";

function findTool(name: string) {
  const tool = englishTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("english (Datamuse) tools", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    responseCache.clear();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("dictionary_rhymes uses rel_rhy by default", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_rhymes");
    await tool.handler({ word: "cat", limit: 20 });

    const url = new URL(capturedUrl);
    expect(url.origin).toBe("https://api.datamuse.com");
    expect(url.pathname).toBe("/words");
    expect(url.searchParams.get("rel_rhy")).toBe("cat");
    expect(url.searchParams.get("max")).toBe("20");
  });

  it("dictionary_rhymes uses rel_nry for near rhymes", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_rhymes");
    await tool.handler({ word: "cat", perfect: false });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("rel_nry")).toBe("cat");
    expect(url.searchParams.has("rel_rhy")).toBe(false);
  });

  it("dictionary_sounds_like uses sl param", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_sounds_like");
    await tool.handler({ word: "knight" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("sl")).toBe("knight");
  });

  it("dictionary_means_like uses ml param without md by default", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_means_like");
    await tool.handler({ query: "ringing in the ears" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("ml")).toBe("ringing in the ears");
    expect(url.searchParams.has("md")).toBe(false);
  });

  it("dictionary_means_like adds md=d when includeDefinitions is true", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_means_like");
    await tool.handler({ query: "happy", includeDefinitions: true });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("md")).toBe("d");
  });

  it("dictionary_spelled_like uses sp param", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_spelled_like");
    await tool.handler({ pattern: "h?llo" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("sp")).toBe("h?llo");
  });

  it("dictionary_suggest hits /sug endpoint", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_suggest");
    await tool.handler({ prefix: "hap" });

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe("/sug");
    expect(url.searchParams.get("s")).toBe("hap");
  });

  it("dictionary_triggers uses rel_trg", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_triggers");
    await tool.handler({ word: "cow" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("rel_trg")).toBe("cow");
  });

  it("dictionary_follows uses lc and optional topics", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_follows");
    await tool.handler({ word: "drink", hint: "morning" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("lc")).toBe("drink");
    expect(url.searchParams.get("topics")).toBe("morning");
  });

  it("dictionary_precedes uses rc", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const tool = findTool("dictionary_precedes");
    await tool.handler({ word: "audience" });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("rc")).toBe("audience");
  });

  it("returns parsed JSON from Datamuse", async () => {
    const expected = [{ word: "bat", score: 100 }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(expected),
    });

    const tool = findTool("dictionary_rhymes");
    const result = await tool.handler({ word: "cat" });
    expect(result).toEqual(expected);
  });
});
