import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  conceptnetRequest,
  wiktionaryRequest,
  datamuseRequest,
  conceptnetUri,
  normalizeWord,
} from "../client.js";
import { responseCache } from "../cache.js";

describe("client helpers", () => {
  describe("normalizeWord", () => {
    it("lowercases and trims", () => {
      expect(normalizeWord("  Hello  ")).toBe("hello");
    });

    it("replaces whitespace with underscores", () => {
      expect(normalizeWord("ice cream")).toBe("ice_cream");
    });

    it("collapses multiple spaces", () => {
      expect(normalizeWord("a   b  c")).toBe("a_b_c");
    });
  });

  describe("conceptnetUri", () => {
    it("builds /c/<lang>/<word> URI", () => {
      expect(conceptnetUri("dog", "en")).toBe("/c/en/dog");
    });

    it("normalizes word into URI", () => {
      expect(conceptnetUri("Ice Cream", "en")).toBe("/c/en/ice_cream");
    });

    it("works with non-English language codes", () => {
      expect(conceptnetUri("perro", "es")).toBe("/c/es/perro");
    });
  });
});

describe("HTTP requests", () => {
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

  it("conceptnetRequest hits the ConceptNet base URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ edges: [] }),
    });

    await conceptnetRequest("/query", { node: "/c/en/dog", limit: 10 });

    const call = mockFetch.mock.calls[0];
    const url = new URL(call[0]);
    expect(url.origin).toBe("https://api.conceptnet.io");
    expect(url.pathname).toBe("/query");
    expect(url.searchParams.get("node")).toBe("/c/en/dog");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("wiktionaryRequest hits the Wiktionary base URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await wiktionaryRequest("/api/rest_v1/page/definition/dog");

    const call = mockFetch.mock.calls[0];
    const url = new URL(call[0]);
    expect(url.origin).toBe("https://en.wiktionary.org");
    expect(url.pathname).toBe("/api/rest_v1/page/definition/dog");
  });

  it("datamuseRequest hits the Datamuse base URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await datamuseRequest("/words", { rel_rhy: "cat", max: 5 });

    const call = mockFetch.mock.calls[0];
    const url = new URL(call[0]);
    expect(url.origin).toBe("https://api.datamuse.com");
    expect(url.searchParams.get("rel_rhy")).toBe("cat");
    expect(url.searchParams.get("max")).toBe("5");
  });

  it("filters out undefined/null/empty params", async () => {
    let capturedUrl = "";
    mockFetch.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await datamuseRequest("/words", {
      ml: "happy",
      max: 10,
      empty: undefined,
      blank: "",
    });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("ml")).toBe("happy");
    expect(url.searchParams.get("max")).toBe("10");
    expect(url.searchParams.has("empty")).toBe(false);
    expect(url.searchParams.has("blank")).toBe(false);
  });

  it("sets Accept and User-Agent headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await conceptnetRequest("/query");

    const call = mockFetch.mock.calls[0];
    expect(call[1].headers.Accept).toBe("application/json");
    expect(call[1].headers["User-Agent"]).toMatch(/multilingual-dictionary-mcp/);
  });

  it("returns parsed JSON on success", async () => {
    const expected = { edges: [{ rel: "/r/Synonym" }] };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(expected),
    });

    const result = await conceptnetRequest("/query");
    expect(result).toEqual(expected);
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(conceptnetRequest("/query")).rejects.toThrow(
      /Request failed 500/
    );
  });

  it("handles text() failure gracefully on error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("parse failed")),
    });

    await expect(conceptnetRequest("/query")).rejects.toThrow(
      /Request failed 503/
    );
  });
});
