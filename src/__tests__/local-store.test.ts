import { describe, it, expect } from "vitest";
import {
  localConceptNetEdges,
  localRhymes,
  localSoundsLike,
  localNumberbatchNeighbors,
} from "../data/local-store.js";

describe("local-store fallback when no data installed", () => {
  it("localConceptNetEdges returns undefined", () => {
    const result = localConceptNetEdges({
      word: "happy",
      language: "en",
      rel: "Synonym",
      direction: "any",
      limit: 10,
    });
    expect(result).toBeUndefined();
  });

  it("localRhymes returns undefined", () => {
    expect(localRhymes("orange", true, 5)).toBeUndefined();
  });

  it("localSoundsLike returns undefined", () => {
    expect(localSoundsLike("knight", 5)).toBeUndefined();
  });

  it("localNumberbatchNeighbors returns undefined", () => {
    expect(localNumberbatchNeighbors("dog", "en", 5)).toBeUndefined();
  });
});
