import { homedir } from "node:os";
import { resolve } from "node:path";

export const DATA_DIR =
  process.env.MDM_DATA_DIR ||
  resolve(homedir(), ".cache", "multilingual-dictionary-mcp");

export const CDN_BASE =
  process.env.MDM_CDN_BASE ||
  "https://multilingual-dictionary-mcp-data.nyc3.cdn.digitaloceanspaces.com";

export const PROFILE = (process.env.MDM_PROFILE as
  | "online"
  | "small"
  | "medium"
  | "full"
  | undefined) ?? "online";

export function manifestUrl(): string {
  return `${CDN_BASE}/manifest.json`;
}

export function localPath(name: string): string {
  return resolve(DATA_DIR, name);
}
