import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResponseCache, responseCache } from "../cache.js";

describe("ResponseCache", () => {
  it("returns undefined for missing key", () => {
    const c = new ResponseCache();
    expect(c.get("missing")).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    const c = new ResponseCache();
    c.set("k", { foo: 1 });
    expect(c.get("k")).toEqual({ foo: 1 });
  });

  it("counts hits and misses", () => {
    const c = new ResponseCache();
    c.set("a", "x");
    c.get("a");
    c.get("a");
    c.get("missing");
    const s = c.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.size).toBe(1);
  });

  it("evicts the least recently used entry when over capacity", () => {
    const c = new ResponseCache(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.get("a");
    c.set("d", 4);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.get("d")).toBe(4);
  });

  it("expires entries after ttl", () => {
    vi.useFakeTimers();
    const c = new ResponseCache(100, 1000);
    c.set("k", "v");
    expect(c.get("k")).toBe("v");
    vi.advanceTimersByTime(1500);
    expect(c.get("k")).toBeUndefined();
    vi.useRealTimers();
  });

  it("does not store anything when disabled", () => {
    const c = new ResponseCache(100, 1000, false);
    c.set("k", "v");
    expect(c.get("k")).toBeUndefined();
    expect(c.stats().size).toBe(0);
  });

  it("clear() empties the store and resets counters", () => {
    const c = new ResponseCache();
    c.set("a", 1);
    c.get("a");
    c.clear();
    const s = c.stats();
    expect(s.size).toBe(0);
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
  });

  it("re-setting a key updates value and recency", () => {
    const c = new ResponseCache(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 99);
    c.set("c", 3);
    expect(c.get("a")).toBe(99);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe(3);
  });
});

describe("singleton responseCache integration with httpGet", () => {
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

  it("caches identical GET requests", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: 42 }),
    });
    const { httpGet } = await import("../client.js");

    const a = await httpGet("https://example.com/api", { q: "x" });
    const b = await httpGet("https://example.com/api", { q: "x" });

    expect(a).toEqual({ value: 42 });
    expect(b).toEqual({ value: 42 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(responseCache.stats().hits).toBeGreaterThanOrEqual(1);
  });

  it("does not cache when bypassCache=true", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ random: Math.random() }),
    });
    const { httpGet } = await import("../client.js");

    await httpGet("https://example.com/random", undefined, { bypassCache: true });
    await httpGet("https://example.com/random", undefined, { bypassCache: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("differentiates cache entries by query params", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: 1 }),
    });
    const { httpGet } = await import("../client.js");

    await httpGet("https://example.com/api", { q: "x" });
    await httpGet("https://example.com/api", { q: "y" });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await httpGet("https://example.com/api", { q: "x" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
