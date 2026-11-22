import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Refusal } from "../mcp/registry.js";
import { type Net, publicFetch, readCapped } from "../urlsafety.js";

export const MAX_PICTURE_BYTES = 8_000_000;
const VIEW_SECONDS = 600;
const UPLOAD_SECONDS = 300;

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

/** The type of a picture the studio keeps, read from its first bytes, or nothing when it is no such picture. */
export const pictureType = (body: Uint8Array): { type: string; ext: string } | undefined => TYPES.find((candidate) => candidate.is(body));

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
  /** The bytes of a small file, or nothing when it is not there yet. */
  read(key: string, maxBytes: number): Promise<Uint8Array | undefined>;
  /** A link that opens the picture for a few minutes, or for `seconds`. */
  viewUrl(key: string, seconds?: number): Promise<string>;
  /** A link that takes one file of exactly this type and size into `key`, for a few minutes. */
  putUrl(key: string, type: string, bytes: number): Promise<string>;
  /** A link that downloads a file under `name` and never shows it in the page. */
  downloadUrl(key: string, name: string): Promise<string>;
  /** Deletes a file. A file that is not there is no fault. */
  remove(key: string): Promise<void>;
}

export class S3Pictures implements Pictures {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Uint8Array, type: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: type }));
  }

  async read(key: string, maxBytes: number): Promise<Uint8Array | undefined> {
    try {
      const found = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if ((found.ContentLength ?? 0) > maxBytes || !found.Body) return undefined;
      return await found.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof NoSuchKey) return undefined;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  viewUrl(key: string, seconds = VIEW_SECONDS): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: seconds });
  }

  putUrl(key: string, type: string, bytes: number): Promise<string> {
    // The type and the length are signed: S3 refuses a file of another type or size.
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: type, ContentLength: bytes }), { expiresIn: UPLOAD_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) });
  }

  downloadUrl(key: string, name: string): Promise<string> {
    const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_");
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${safe}"`, ResponseContentType: "application/octet-stream" }), { expiresIn: VIEW_SECONDS });
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
