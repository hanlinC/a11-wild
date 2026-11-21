/** Markdown marks removed, so a quote copied from the page as shown still matches the page as text. */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#|>\\]/g, " ");
}

/** Lower case, curly quotes to straight, every dash to '-', all white space to one space. */
export function normalise(text: string): string {
  return plain(text)
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the quote, normalised, is in the page text, normalised. An empty quote is never found. */
export function quoteIn(quote: string, pageText: string): boolean {
  const wanted = normalise(quote);
  return wanted.length > 0 && normalise(pageText).includes(wanted);
}
