import { describe, it, expect } from "vitest";
import { relationTools } from "../tools/relations.js";

function findTool(name: string) {
  const tool = relationTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("relation tools — offline-only behavior", () => {
  // Without local data installed, every tool throws a clear error message
  // pointing the user to MDM_PROFILE.
  for (const name of [
    "dictionary_synonyms",
    "dictionary_antonyms",
    "dictionary_hypernyms",
    "dictionary_hyponyms",
    "dictionary_meronyms",
    "dictionary_holonyms",
    "dictionary_derived_from",
    "dictionary_etymologically_related",
    "dictionary_used_for",
    "dictionary_capable_of",
    "dictionary_at_location",
    "dictionary_translate",
    "dictionary_all_relations",
  ]) {
    it(`${name} throws helpful error when offline data missing`, async () => {
      const tool = findTool(name);
      await expect(
        tool.handler({ word: "happy", language: "en" } as any)
      ).rejects.toThrow(/offline|CDN/);
    });
  }

  it("dictionary_semantic_neighbors throws when Numberbatch missing", async () => {
    const tool = findTool("dictionary_semantic_neighbors");
    await expect(
      tool.handler({ word: "happy", language: "en", limit: 10 })
    ).rejects.toThrow(/Numberbatch/);
  });

  it("dictionary_related throws (falls through to ConceptNet RelatedTo, also missing)", async () => {
    const tool = findTool("dictionary_related");
    await expect(
      tool.handler({ word: "happy", language: "en" })
    ).rejects.toThrow(/offline|CDN/);
  });
});
