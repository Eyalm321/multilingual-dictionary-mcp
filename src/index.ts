#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { relationTools } from "./tools/relations.js";
import { definitionTools } from "./tools/definitions.js";
import { englishTools } from "./tools/english.js";
import { statusTools } from "./tools/status.js";
import { ensureDataInstalled } from "./data/installer.js";

const server = new McpServer({
  name: "multilingual-dictionary-mcp",
  version: "0.3.4",
});

// Status tools first so they're registered alphabetically before any tools
// that depend on the offline data — purely cosmetic for tool listings.
const allTools = [
  ...statusTools,
  ...relationTools,
  ...definitionTools,
  ...englishTools,
];

for (const tool of allTools) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema.shape as any,
    async (args: any) => {
      try {
        const result = await tool.handler(args as any);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

async function main() {
  // Connect MCP transport FIRST so the client sees tools immediately. The
  // dictionary_status and dictionary_install tools are usable even while the
  // data bundle is still downloading.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    "Multilingual Dictionary MCP server running — kicking off data install in background"
  );

  // Fire-and-forget the install. Progress is observable via dictionary_status.
  ensureDataInstalled().catch((err) => {
    console.error("[mdm-data] install failed (continuing):", err);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
