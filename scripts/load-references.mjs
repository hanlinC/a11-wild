#!/usr/bin/env node
// Loads the owner's reference ads from files on this machine into the studio: each picture goes to the
// private store, with a row that says which kinds of ad it is a reference for.
//
//   npm run references:load -- <manifest.json> [--dry-run]
//
// The manifest stays outside the repository, with the pictures. It is a list of:
//   { "file": "ads/one.jpg", "kinds": ["v2", "v3"], "brand": "…", "title": "…", "why": "…", "loose": false }
// A file path is relative to the manifest. A picture that is already loaded (same bytes) is skipped,
// so the script is safe to run again. Uses the AWS credentials and Region of your shell.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STACK = "A11WildStudio";
const KINDS = ["v1", "v2", "v3"];
const MAX_BYTES = 12_000_000;
const TYPES = [
  { ext: "png", type: "image/png", is: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", type: "image/jpeg", is: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", type: "image/webp", is: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

/** The faults of a manifest, one line each. Empty when it is good. */
export function manifestFaults(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return ["The manifest is a list with one entry or more."];
  return entries.flatMap((entry, index) => {
    const at = `Entry ${index + 1}`;
    const faults = [];
    if (!text(entry?.file, 500)) faults.push(`${at}: file is missing.`);
    if (!Array.isArray(entry?.kinds) || entry.kinds.length === 0 || entry.kinds.some((kind) => !KINDS.includes(kind))) faults.push(`${at}: kinds is a list of v1, v2 or v3.`);
    if (!text(entry?.brand, 80)) faults.push(`${at}: brand is 1 to 80 characters.`);
    if (!text(entry?.title, 200)) faults.push(`${at}: title is 1 to 200 characters.`);
    if (!text(entry?.why, 500)) faults.push(`${at}: why is 1 to 500 characters.`);
    if (entry?.loose !== undefined && typeof entry.loose !== "boolean") faults.push(`${at}: loose is true or false.`);
    return faults;
  });
}

/** The picture type of some bytes, by their first bytes. */
export const pictureType = (bytes) => TYPES.find((type) => type.is(bytes));

/** The row and the key of one reference. The id comes from the picture's bytes, so the same picture is one reference. */
export function referenceRow(entry, bytes, now, savedBy) {
  const type = pictureType(bytes);
  if (!type) throw new Error(`${entry.file} is not a PNG, JPEG or WebP picture.`);
  const id = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const key = `references/${id}.${type.ext}`;
  return {
    type: type.type,
    key,
    item: {
      pk: "REFS",
      sk: id,
      id,
      kinds: [...new Set(entry.kinds)],
      brand: entry.brand.trim(),
      title: entry.title.trim(),
      why: entry.why.trim(),
      ...(entry.loose ? { loose: true } : {}),
      picture: { key, sourceUrl: "owner upload" },
      addedAt: now.toISOString(),
      savedBy,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    console.error("Usage: npm run references:load -- <manifest.json> [--dry-run]");
    process.exit(1);
  }
  const entries = JSON.parse(await readFile(path, "utf8"));
  const faults = manifestFaults(entries);
  if (faults.length > 0) {
    console.error(faults.join("\n"));
    process.exit(1);
  }
  const base = Date.now();
  const rows = [];
  for (const [index, entry] of entries.entries()) {
    const bytes = await readFile(resolve(dirname(path), entry.file));
    if (bytes.length > MAX_BYTES) throw new Error(`${entry.file} is larger than ${MAX_BYTES} bytes.`);
    // One millisecond apart, so the references keep the manifest's order.
    rows.push({ ...referenceRow(entry, bytes, new Date(base + index), "owner"), bytes });
  }
  if (dry) {
    console.log(`${rows.length} reference(s) are ready. Nothing was written.`);
    return;
  }

  const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation");
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, GetCommand, PutCommand } = await import("@aws-sdk/lib-dynamodb");
  const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  const stacks = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: STACK }));
  const outputs = Object.fromEntries((stacks.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
  if (!outputs.TableName || !outputs.PicturesBucketName) {
    console.error(`Stack ${STACK} has no TableName or PicturesBucketName output. Deploy it first.`);
    process.exit(1);
  }
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  let added = 0;
  for (const { item, key, type, bytes } of rows) {
    const before = await doc.send(new GetCommand({ TableName: outputs.TableName, Key: { pk: item.pk, sk: item.sk } }));
    if (before.Item) continue;
    await s3.send(new PutObjectCommand({ Bucket: outputs.PicturesBucketName, Key: key, Body: bytes, ContentType: type }));
    await doc.send(new PutCommand({ TableName: outputs.TableName, Item: item }));
    added += 1;
  }
  console.log(`Loaded ${added} reference(s). ${rows.length - added} were there already.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
