import { describe, it, expect } from "vitest";
import { statusTools } from "../tools/status.js";

function findTool(name: string) {
  const tool = statusTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("status tools — always available", () => {
  it("dictionary_status returns a structured snapshot without throwing", async () => {
    const tool = findTool("dictionary_status");
    const result = (await tool.handler({})) as Record<string, unknown>;
    expect(result).toHaveProperty("state");
    expect(result).toHaveProperty("dataDir");
    expect(result).toHaveProperty("cdnBase");
    expect(result).toHaveProperty("totalArtifacts");
    expect(result).toHaveProperty("readyArtifacts");
    expect(result).toHaveProperty("artifacts");
    expect(result).toHaveProperty("ready");
    expect(result).toHaveProperty("summary");
    expect(typeof result.summary).toBe("string");
  });

  it("dictionary_status state is one of pending|downloading|ready|failed", async () => {
    const tool = findTool("dictionary_status");
    const result = (await tool.handler({})) as { state: string };
    expect(["pending", "downloading", "ready", "failed"]).toContain(result.state);
  });

  it("dictionary_install does not throw when called without data", async () => {
    const tool = findTool("dictionary_install");
    // Don't actually wait for it — install will fail offline in CI but
    // the handler must return synchronously regardless.
    await expect(
      Promise.race([
        tool.handler({}),
        new Promise((res) => setTimeout(res, 100)),
      ])
    ).resolves.toBeDefined();
  });
});
