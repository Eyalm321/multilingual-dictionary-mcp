import { describe, it, expect } from "vitest";
import { definitionTools } from "../tools/definitions.js";

function findTool(name: string) {
  const tool = definitionTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("definition tools — offline-only behavior", () => {
  for (const name of [
    "dictionary_lookup",
    "dictionary_summary",
    "dictionary_etymology",
    "dictionary_pronunciation",
    "dictionary_search",
    "dictionary_random",
  ]) {
    it(`${name} throws helpful error when offline data missing`, async () => {
      const tool = findTool(name);
      const args =
        name === "dictionary_search"
          ? { query: "hap" }
          : name === "dictionary_random"
          ? {}
          : { word: "happy" };
      await expect(tool.handler(args as any)).rejects.toThrow(/MDM_PROFILE/);
    });
  }
});
