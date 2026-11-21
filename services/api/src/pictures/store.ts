import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Refusal } from "../mcp/registry.js";
import { type Net, publicFetch, readCapped } from "../urlsafety.js";

export const MAX_PICTURE_BYTES = 8_000_000;
const VIEW_SECONDS = 600;

/** The picture types the studio keeps, told by the file's first bytes and not by what the sender says. */
const TYPES: { type: string; ext: string; is: (b: Uint8Array) => boolean }[] = [
  { type: "image/png", ext: "png", is: (b) => b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { type: "image/jpeg", ext: "jpg", is: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/webp",
    ext: "webp",
    is: (b) => b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
];

export interface StoredPicture {
  key: string;
  type: string;
  bytes: number;
  /** Where the picture was copied from. */
  sourceUrl: string;
}

/** The private picture store. A picture is read only through a short-lived link made for a signed-in reader. */
export interface Pictures {
  put(key: string, body: Uint8Array, type: string): Promise<void>;
  /** A link that opens the picture for a few minutes. */
  viewUrl(key: string): Promise<string>;
}

export class S3Pictures implements Pictures {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Uint8Array, type: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: type }));
  }

  viewUrl(key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: VIEW_SECONDS });
  }
}

/** Copies a picture from a public https address into the store, under `folder`. */
export async function copyPicture(input: { url: string; folder: string; what: string }, net: Net, pictures: Pictures): Promise<StoredPicture> {
  const { response } = await publicFetch(input.url, input.what, net, {
    headers: { "user-agent": "Mozilla/5.0 (a11-wild)", accept: "image/*" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Refusal(`${input.what} did not answer (status ${response.status}).`);
  }
  const body = await readCapped(response, input.what, MAX_PICTURE_BYTES);
  const kind = TYPES.find((candidate) => candidate.is(body));
  if (!kind) throw new Refusal(`${input.what} is not a PNG, JPEG or WebP picture.`);
  const key = `${input.folder}/${randomUUID()}.${kind.ext}`;
  await pictures.put(key, body, kind.type);
  return { key, type: kind.type, bytes: body.byteLength, sourceUrl: input.url };
}
