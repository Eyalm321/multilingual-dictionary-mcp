import { z } from "zod";
import {
  getInstallStatus,
  ensureDataInstalled,
  dataInstallSummary,
  isDataReady,
} from "../data/installer.js";

export const statusTools = [
  {
    name: "dictionary_status",
    description:
      "Get the current state of the offline data installation. Always available — even before the bundle has finished downloading. Returns: state (pending/downloading/ready/failed), per-artifact progress, total bytes downloaded, data directory, CDN URL, manifest version, and any error.",
    inputSchema: z.object({}),
    handler: async () => {
      return {
        ...getInstallStatus(),
        ready: isDataReady(),
        summary: dataInstallSummary(),
      };
    },
  },
  {
    name: "dictionary_install",
    description:
      "Manually kick off (or re-trigger) the offline data download. Returns immediately while the install runs in the background. Idempotent — calling repeatedly while a download is in progress is a no-op. Use dictionary_status to track progress.",
    inputSchema: z.object({}),
    handler: async () => {
      // Don't await — fire and forget.
      ensureDataInstalled().catch(() => {
        /* errors are reflected in dictionary_status */
      });
      return {
        triggered: true,
        ...getInstallStatus(),
        summary: dataInstallSummary(),
      };
    },
  },
];
