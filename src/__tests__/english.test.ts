import { describe, it, expect } from "vitest";
import { englishTools } from "../tools/english.js";

function findTool(name: string) {
  const tool = englishTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("english tools — offline-only behavior", () => {
  it("dictionary_rhymes throws helpful error when CMU dict missing", async () => {
    const tool = findTool("dictionary_rhymes");
    await expect(tool.handler({ word: "cat" })).rejects.toThrow(/offline|CDN/);
  });

  it("dictionary_sounds_like throws helpful error", async () => {
    const tool = findTool("dictionary_sounds_like");
    await expect(tool.handler({ word: "knight" })).rejects.toThrow(/offline|CDN/);
  });

  it("dictionary_means_like throws helpful error", async () => {
    const tool = findTool("dictionary_means_like");
    await expect(tool.handler({ query: "happy" })).rejects.toThrow(/offline|CDN/);
  });

  it("dictionary_spelled_like throws helpful error", async () => {
    const tool = findTool("dictionary_spelled_like");
    await expect(tool.handler({ pattern: "h?llo" })).rejects.toThrow(/offline|CDN/);
  });

  it("dictionary_suggest throws helpful error", async () => {
    const tool = findTool("dictionary_suggest");
    await expect(tool.handler({ prefix: "hap" })).rejects.toThrow(/offline|CDN/);
  });
});
