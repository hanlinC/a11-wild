import type { FontFile } from "@a11-wild/shared";
import { Refusal } from "../mcp/registry.js";
import type { Pictures } from "../pictures/store.js";
import { type Net, publicFetch, readCapped } from "../urlsafety.js";

export const MAX_FONT_BYTES = 5_000_000;
const GOOGLE_FILES = "fonts.gstatic.com";

/** The font types the studio keeps, told by the file's first bytes. */
const TYPES: { ext: string; type: string; magic: number[] }[] = [
  { ext: "ttf", type: "font/ttf", magic: [0x00, 0x01, 0x00, 0x00] },
  { ext: "ttf", type: "font/ttf", magic: [0x74, 0x72, 0x75, 0x65] },
  { ext: "otf", type: "font/otf", magic: [0x4f, 0x54, 0x54, 0x4f] },
  { ext: "woff", type: "font/woff", magic: [0x77, 0x4f, 0x46, 0x46] },
  { ext: "woff2", type: "font/woff2", magic: [0x77, 0x4f, 0x46, 0x32] },
];

const slug = (family: string) =>
  family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function fetched(url: string, what: string, net: Net, max: number): Promise<Uint8Array> {
  // No browser user agent, so Google Fonts names a TrueType file.
  const { response } = await publicFetch(url, what, net, { headers: { "user-agent": "a11-wild", accept: "*/*" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Refusal(`${what} did not answer (status ${response.status}).`);
  }
  return readCapped(response, what, max);
}

/**
 * Copies one font file of a brand into the private store. Without an address, the family comes from Google Fonts at that weight.
 * With one, it is the file the brand's own site serves (its @font-face address).
 */
export async function copyFont(input: { brandId: string; family: string; weight: number; url?: string }, net: Net, pictures: Pictures): Promise<FontFile> {
  let source = input.url;
  if (!source) {
    const css = new TextDecoder().decode(
      await fetched(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(input.family.trim()).replace(/%20/g, "+")}:wght@${input.weight}`, "Google Fonts", net, 200_000).catch((error: unknown) => {
        if (error instanceof Refusal) {
          throw new Refusal(`"${input.family}" at weight ${input.weight} is not on Google Fonts. Find the font file the brand's own site serves (its @font-face address, a .woff2 or .ttf) and give it as url. If there is none, tell the owner before you use another family.`);
        }
        throw error;
      }),
    );
    source = /src:\s*url\((https:\/\/[^)]+)\)/.exec(css)?.[1];
    if (!source || new URL(source).hostname !== GOOGLE_FILES) throw new Refusal(`Google Fonts gave no file for "${input.family}" at weight ${input.weight}.`);
  }
  const body = await fetched(source, "The font file", net, MAX_FONT_BYTES);
  const kind = TYPES.find((candidate) => candidate.magic.every((value, index) => body[index] === value));
  if (!kind) throw new Refusal("That file is not a TrueType, OpenType, WOFF or WOFF2 font.");
  const key = `brands/${input.brandId}/fonts/${slug(input.family) || "font"}-${input.weight}.${kind.ext}`;
  await pictures.put(key, body, kind.type);
  return { family: input.family.trim(), weight: input.weight, key, sourceUrl: source };
}

/** The saved file of a family at a weight, or the nearest weight of that family. */
export function fontOf(files: FontFile[] | undefined, family: string | undefined, weight: number): FontFile | undefined {
  const mine = (files ?? []).filter((file) => !family || file.family.toLowerCase() === family.trim().toLowerCase());
  return [...mine].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
}
