import { isPublicHttpsUrl } from "../urlsafety.js";

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\\\//g, "/");
const PICTURE = /\.(?:png|jpe?g|webp)$/i;
/** Page furniture, not the product: icons, badges, payment marks and the like. */
const FURNITURE = /icon|logo|sprite|badge|payment|avatar|placeholder|loader|spinner|flag|emoji|star|pixel|tracking/i;
/** The widest version the studio asks a shop for. Wide enough for a reference, small enough to store. */
const WIDEST = 2000;

function absolute(href: string, base: string): URL | null {
  try {
    const url = new URL(decode(href.trim()), base);
    return isPublicHttpsUrl(url.href) && PICTURE.test(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2).find((value) => value !== undefined);

/** The widest entry of a srcset that is not wider than the studio wants, else its last entry. */
function widest(srcset: string): string | undefined {
  const entries = srcset
    .split(/,\s+/)
    .map((entry) => entry.trim().split(/\s+/))
    .flatMap(([href, size]) => (href ? [{ href, width: size?.endsWith("w") ? Number.parseInt(size, 10) : 0 }] : []));
  const fits = entries.filter((entry) => entry.width <= WIDEST).sort((a, b) => b.width - a.width)[0];
  return (fits ?? entries.at(-1))?.href;
}

function jsonLdImages(html: string): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if ([record["@type"]].flat().includes("Product")) {
      for (const image of [record.image].flat()) {
        if (typeof image === "string") found.push(image);
        else if (image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string") found.push((image as { url: string }).url);
      }
    }
    Object.values(record).forEach(walk);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(match[1]!));
    } catch {
      // A broken block is skipped: the other sources still give candidates.
    }
  }
  return found;
}

/**
 * The pictures of a product page that may show the product: what the page names as the product's image first,
 * then its share picture, then the pictures in the page. One address for each picture file, at a width the studio can store.
 */
export function productPictures(html: string, pageUrl: string, max = 40): string[] {
  const named = [
    ...jsonLdImages(html),
    ...[...html.matchAll(/<meta\b[^>]*>/gi)]
      .map((match) => match[0])
      .filter((tag) => /^og:image(?::secure_url)?$/i.test(attr(tag, "property") ?? ""))
      .flatMap((tag) => attr(tag, "content") ?? []),
  ];
  const inPage = [...html.matchAll(/<(?:img|source)\b[^>]*>/gi)].flatMap((match) => {
    const tag = match[0];
    const width = Number.parseInt(attr(tag, "width") ?? "", 10);
    if (width > 0 && width < 200) return [];
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    return [(srcset && widest(srcset)) || attr(tag, "src") || attr(tag, "data-src") || []].flat();
  });

  const byFile = new Map<string, string>();
  for (const [href, isNamed] of [...named.map((href) => [href, true] as const), ...inPage.map((href) => [href, false] as const)]) {
    const url = absolute(href, pageUrl);
    if (!url || (!isNamed && FURNITURE.test(url.pathname))) continue;
    const file = `${url.host}${url.pathname}`;
    if (!byFile.has(file)) byFile.set(file, url.href);
  }
  return [...byFile.values()].slice(0, max);
}
