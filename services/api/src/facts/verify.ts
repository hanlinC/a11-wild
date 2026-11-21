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

const WORDY = /[\p{L}\p{N}]/u;
const wordy = (char: string | undefined) => char !== undefined && WORDY.test(char);
const digit = (char: string | undefined) => char !== undefined && /\d/.test(char);

/**
 * True when the quote, normalised, is in the page text, normalised, as whole words and whole numbers.
 * "50 g" is not in "250 g" or "2.50 g", and "95" is not in "95.5". An empty quote is never found.
 */
export function quoteIn(quote: string, pageText: string): boolean {
  const wanted = normalise(quote);
  if (wanted.length === 0) return false;
  const page = normalise(pageText);
  const first = wanted[0];
  const last = wanted.at(-1);
  for (let at = page.indexOf(wanted); at !== -1; at = page.indexOf(wanted, at + 1)) {
    const before = page[at - 1];
    const after = page[at + wanted.length];
    const cutsStart = (wordy(first) && wordy(before)) || (digit(first) && /[.,]/.test(before ?? "") && digit(page[at - 2]));
    const cutsEnd = (wordy(last) && wordy(after)) || (digit(last) && /[.,]/.test(after ?? "") && digit(page[at + wanted.length + 1]));
    if (!cutsStart && !cutsEnd) return true;
  }
  return false;
}
