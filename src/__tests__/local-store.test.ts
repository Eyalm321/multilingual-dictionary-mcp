import { describe, it, expect } from "vitest";
import {
  localConceptNetEdges,
  localRhymes,
  localSoundsLike,
  localSpelledLike,
  localSuggest,
  localNumberbatchNeighbors,
  localWiktextractByWord,
  localWiktextractSearch,
  localWiktextractRandom,
} from "../data/local-store.js";

describe("local-store fallback when no data installed", () => {
  // These tests run in CI where the data isn't downloaded. They verify that
  // every local lookup returns undefined cleanly so callers can detect missing
  // data and surface a helpful error instead of crashing.
  it("localConceptNetEdges returns undefined", () => {
    expect(
      localConceptNetEdges({
        word: "happy",
        language: "en",
        rel: "Synonym",
        direction: "any",
        limit: 10,
      })
    ).toBeUndefined();
  });

  it("localRhymes returns undefined", () => {
    expect(localRhymes("orange", true, 5)).toBeUndefined();
  });

  it("localSoundsLike returns undefined", () => {
    expect(localSoundsLike("knight", 5)).toBeUndefined();
  });

  it("localSpelledLike returns undefined", () => {
    expect(localSpelledLike("h?llo", 5)).toBeUndefined();
  });

  it("localSuggest returns undefined", () => {
    expect(localSuggest("hap", 5)).toBeUndefined();
  });

  it("localNumberbatchNeighbors returns undefined", () => {
    expect(localNumberbatchNeighbors("dog", "en", 5)).toBeUndefined();
  });

  it("localWiktextractByWord returns undefined", () => {
    expect(localWiktextractByWord("dog", "en", 10)).toBeUndefined();
  });

  it("localWiktextractSearch returns undefined", () => {
    expect(localWiktextractSearch("hap", undefined, 10)).toBeUndefined();
  });

  it("localWiktextractRandom returns undefined", () => {
    expect(localWiktextractRandom("en")).toBeUndefined();
  });
});
