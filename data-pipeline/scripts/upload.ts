/**
 * Uploads everything in build/ to the DigitalOcean Spaces bucket.
 * Requires DO_SPACES_KEY and DO_SPACES_SECRET in env.
 *
 * Usage:
 *   DO_SPACES_KEY=... DO_SPACES_SECRET=... npm run upload
 */
import { readdirSync, statSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { BUILD_DIR } from "./common.js";

const KEY = process.env.DO_SPACES_KEY;
const SECRET = process.env.DO_SPACES_SECRET;
const REGION = process.env.DO_SPACES_REGION || "nyc3";
const BUCKET =
  process.env.DO_SPACES_BUCKET || "multilingual-dictionary-mcp-data";

if (!KEY || !SECRET) {
  console.error("Set DO_SPACES_KEY and DO_SPACES_SECRET env vars.");
  process.exit(2);
}

const contentTypeFor = (name: string): string => {
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".sqlite")) return "application/vnd.sqlite3";
  if (name.endsWith(".bin")) return "application/octet-stream";
  return "application/octet-stream";
};

async function main() {
  const client = new S3Client({
    endpoint: `https://${REGION}.digitaloceanspaces.com`,
    region: REGION,
    credentials: {
      accessKeyId: KEY!,
      secretAccessKey: SECRET!,
    },
    forcePathStyle: false,
  });

  const files = readdirSync(BUILD_DIR).filter((n) =>
    statSync(resolve(BUILD_DIR, n)).isFile()
  );
  for (const name of files) {
    const path = resolve(BUILD_DIR, name);
    const size = statSync(path).size;
    console.log(`[upload] ${name} (${(size / 1_000_000).toFixed(1)} MB)`);
    const upload = new Upload({
      client,
      params: {
        Bucket: BUCKET,
        Key: name,
        Body: createReadStream(path),
        ACL: "public-read",
        ContentType: contentTypeFor(name),
        CacheControl: "public, max-age=86400, immutable",
      },
      queueSize: 4,
      partSize: 16 * 1024 * 1024,
      leavePartsOnError: false,
    });
    upload.on("httpUploadProgress", (p) => {
      if (p.loaded && p.total) {
        const pct = ((p.loaded / p.total) * 100).toFixed(1);
        process.stdout.write(`\r  ${pct}%   `);
      }
    });
    await upload.done();
    process.stdout.write("\n");
  }
  console.log("[done] all uploads complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
