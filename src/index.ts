#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { relationTools } from "./tools/relations.js";
import { definitionTools } from "./tools/definitions.js";
import { englishTools } from "./tools/english.js";
import { adminTools } from "./tools/admin.js";
import { ensureDataInstalled } from "./data/installer.js";

const server = new McpServer({
  name: "multilingual-dictionary-mcp",
  version: "0.3.0",
});

const allTools = [
  ...relationTools,
  ...definitionTools,
  ...englishTools,
  ...adminTools,
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
  // If MDM_PROFILE is set to anything other than "online", kick off the
  // first-run install in the background. The first lookup may go online while
  // data is still downloading; subsequent ones use local data.
  ensureDataInstalled().catch((err) => {
    console.error("[mdm-data] install failed (continuing online):", err);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Multilingual Dictionary MCP server running");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
