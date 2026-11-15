/**
 * Trust path of the data installer: the data host is untrusted, only the pinned artifacts
 * are accepted, and a valid local cache is never replaced or lost. Everything runs against a
 * local HTTP server (or a dead port) with small fake artifacts and matching test pins.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installWith, newStatus, validateManifest } from "../data/installer.js";
import type { Pins } from "../data/pinned.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const FILES: Record<string, Buffer> = {
  "a.sqlite": Buffer.from("alpha artifact ".repeat(200)),
  "b.bin": Buffer.from("bravo artifact"),
};
const PINS: Pins = Object.fromEntries(
  Object.entries(FILES).map(([n, b]) => [n, { sha256: sha(b), size: b.length }])
);

function manifestFor(base: string, files: Record<string, Buffer>, gz: string[] = []) {
  return {
    version: 3,
    builtAt: "2026-07-01T00:00:00Z",
    cdnBase: base,
    artifacts: Object.entries(files).map(([name, b]) => ({
      name,
      url: `${base}/${name}`,
      size: b.length,
      sha256: sha(b),
      ...(gz.includes(name)
        ? { compressedUrl: `${base}/${name}.gz`, compressedSize: gzipSync(b).length }
        : {}),
    })),
  };
}

let dataDir: string;
let server: Server | undefined;
let requests: string[];

async function serve(routes: Record<string, Buffer | string>): Promise<string> {
  requests = [];
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    const body = routes[req.url ?? ""];
    if (body === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(body);
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

function seedCache() {
  for (const [n, b] of Object.entries(FILES)) writeFileSync(join(dataDir, n), b);
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "mdm-installer-"));
});

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("installer trust path", () => {
  it("installs the pinned bundle from a host that serves it (plain + gzip)", async () => {
    // The manifest's URLs point at a dead host; the installer must build URLs from its own base.
    const base2 = await serve({
      "/manifest.json": JSON.stringify(manifestFor("http://127.0.0.1:1", FILES, ["a.sqlite"])),
      "/a.sqlite.gz": gzipSync(FILES["a.sqlite"]),
      "/b.bin": FILES["b.bin"],
    });
    const st = newStatus({ cdnBase: base2, dataDir });
    await installWith({ cdnBase: base2, dataDir, pins: PINS }, st);
    expect(st.state).toBe("ready");
    expect(readFileSync(join(dataDir, "a.sqlite"))).toEqual(FILES["a.sqlite"]);
    expect(readFileSync(join(dataDir, "b.bin"))).toEqual(FILES["b.bin"]);
    expect(existsSync(join(dataDir, "a.sqlite.verified"))).toBe(true);
  });

  it("dead host + valid cache: ready, cache kept, no error", async () => {
    seedCache();
    const st = newStatus({ cdnBase: "http://127.0.0.1:1", dataDir });
    await installWith({ cdnBase: "http://127.0.0.1:1", dataDir, pins: PINS }, st);
    expect(st.state).toBe("ready");
    expect(st.readyArtifacts).toBe(2);
    for (const [n, b] of Object.entries(FILES)) expect(readFileSync(join(dataDir, n))).toEqual(b);
  });

  it("dead host + no cache: fails with a clear message (URL, MDM_CDN_BASE, README)", async () => {
    const st = newStatus({ cdnBase: "http://127.0.0.1:1", dataDir });
    await expect(installWith({ cdnBase: "http://127.0.0.1:1", dataDir, pins: PINS }, st)).rejects.toThrow(
      /data host unreachable: http:\/\/127\.0\.0\.1:1\/manifest\.json/
    );
    expect(st.state).toBe("failed");
    expect(st.error).toMatch(/MDM_CDN_BASE/);
    expect(st.error).toMatch(/Building the data bundle yourself/);
  });

  it("host returns 404 (deleted bucket): clear message with the status code", async () => {
    const base = await serve({});
    const st = newStatus({ cdnBase: base, dataDir });
    await expect(installWith({ cdnBase: base, dataDir, pins: PINS }, st)).rejects.toThrow(/HTTP 404/);
  });

  it("tampered manifest (changed sha) is refused and the existing cache is untouched", async () => {
    // Partial cache: a.sqlite is valid, b.bin is missing, so the installer has to ask the host.
    writeFileSync(join(dataDir, "a.sqlite"), FILES["a.sqlite"]);
    const evil = { ...FILES, "a.sqlite": Buffer.from("attacker data") };
    const base2 = await serve({
      "/manifest.json": JSON.stringify(manifestFor("x", evil)),
      "/a.sqlite": evil["a.sqlite"],
      "/b.bin": FILES["b.bin"],
    });
    const st = newStatus({ cdnBase: base2, dataDir });
    await expect(installWith({ cdnBase: base2, dataDir, pins: PINS }, st)).rejects.toThrow(/manifest refused/);
    expect(readFileSync(join(dataDir, "a.sqlite"))).toEqual(FILES["a.sqlite"]);
    expect(requests).toEqual(["/manifest.json"]); // nothing downloaded after the refusal
  });

  it("a fully cached bundle never consults the host, even if it serves a tampered manifest", async () => {
    seedCache();
    const evil = { ...FILES, "b.bin": Buffer.from("attacker data") };
    const base = await serve({ "/manifest.json": JSON.stringify(manifestFor("x", evil)), "/b.bin": evil["b.bin"] });
    const st = newStatus({ cdnBase: base, dataDir });
    await installWith({ cdnBase: base, dataDir, pins: PINS }, st);
    expect(st.state).toBe("ready");
    expect(requests).toEqual([]);
    expect(readFileSync(join(dataDir, "b.bin"))).toEqual(FILES["b.bin"]);
  });

  it("manifest matching the pins but a tampered file: refused, nothing written", async () => {
    const base2 = await serve({
      "/manifest.json": JSON.stringify(manifestFor("x", FILES)),
      "/a.sqlite": Buffer.from("x".repeat(FILES["a.sqlite"].length)),
      "/b.bin": FILES["b.bin"],
    });
    const st = newStatus({ cdnBase: base2, dataDir });
    await expect(installWith({ cdnBase: base2, dataDir, pins: PINS }, st)).rejects.toThrow(
      /refused a\.sqlite .* pinned sha256/
    );
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it("a stale marker for unpinned data doesn't count as cached, and the bad file is only replaced by a verified download", async () => {
    writeFileSync(join(dataDir, "b.bin"), FILES["b.bin"]);
    writeFileSync(join(dataDir, "a.sqlite"), Buffer.from("old unpinned"));
    writeFileSync(join(dataDir, "a.sqlite.verified"), JSON.stringify({ sha256: "0".repeat(64), size: 12, mtimeMs: 0 }));
    const base2 = await serve({
      "/manifest.json": JSON.stringify(manifestFor("x", FILES)),
      "/a.sqlite": FILES["a.sqlite"],
    });
    const st = newStatus({ cdnBase: base2, dataDir });
    await installWith({ cdnBase: base2, dataDir, pins: PINS }, st);
    expect(st.state).toBe("ready");
    expect(readFileSync(join(dataDir, "a.sqlite"))).toEqual(FILES["a.sqlite"]);
    expect(requests).toEqual(["/manifest.json", "/a.sqlite"]);
  });
});

describe("validateManifest", () => {
  const ok = manifestFor("x", FILES);
  it("accepts exactly the pinned artifacts", () => {
    expect(validateManifest(ok, PINS).artifacts).toHaveLength(2);
  });
  it("refuses an extra artifact", () => {
    const extra = manifestFor("x", { ...FILES, "c.so": Buffer.from("c") });
    expect(() => validateManifest(extra, PINS)).toThrow(/unexpected: c\.so/);
  });
  it("refuses a missing artifact", () => {
    const { ["b.bin"]: _b, ...rest } = FILES;
    expect(() => validateManifest(manifestFor("x", rest), PINS)).toThrow(/missing: b\.bin/);
  });
  it("refuses a changed size", () => {
    const m = manifestFor("x", FILES);
    m.artifacts[1].size += 1;
    expect(() => validateManifest(m, PINS)).toThrow(/b\.bin does not match/);
  });
  it("refuses malformed input", () => {
    expect(() => validateManifest(null, PINS)).toThrow(/malformed/);
    expect(() => validateManifest({ artifacts: "nope" }, PINS)).toThrow(/malformed/);
  });
});
