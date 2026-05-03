import { describe, it, expect } from "vitest";
import { relationTools } from "../tools/relations.js";
import { definitionTools } from "../tools/definitions.js";
import { englishTools } from "../tools/english.js";

const allTools = [...relationTools, ...definitionTools, ...englishTools];

describe("Tool Registration", () => {
  it("has no duplicate tool names across all modules", () => {
    const names = allTools.map((t) => t.name);
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
    expect(duplicates).toEqual([]);
  });

  it("all tools have required properties", () => {
    for (const tool of allTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("all tool names follow dictionary_ naming convention", () => {
    for (const tool of allTools) {
      expect(tool.name).toMatch(/^dictionary_/);
    }
  });

  it("registers a non-trivial number of tools", () => {
    expect(allTools.length).toBeGreaterThanOrEqual(20);
  });

  it("each module exports a non-empty array", () => {
    const modules = [relationTools, definitionTools, englishTools];
    for (const mod of modules) {
      expect(Array.isArray(mod)).toBe(true);
      expect(mod.length).toBeGreaterThan(0);
    }
  });

  it("input schemas are zod objects with .shape", () => {
    for (const tool of allTools) {
      expect((tool.inputSchema as any).shape).toBeDefined();
    }
  });

  it("descriptions are reasonably descriptive", () => {
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});
