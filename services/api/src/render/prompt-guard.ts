/**
 * Hard check R16: a picture carries the brand logo and no words. A prompt that asks the model
 * to paint words is refused before anything is sent or paid for.
 */
const ASKS_FOR_WORDS: RegExp[] = [
  /\b(headlines?|taglines?|slogans?|captions?|subtitles?|sub-?heads?|call[- ]to[- ]action|cta|buttons?|lettering|typography|speech bubbles?|price tags?|hashtags?|urls?|web ?addresses?|watermarks?)\b/i,
  /\b(text|words?|copy|signs?|banners?|posters?|labels?|notes?|cards?)\s+(?:that\s+|which\s+)?(says?|reads?|saying|reading|stating|states?)\b/i,
  /\b(written|handwritten|hand-written|spelled out|spelling out|spells out)\b/i,
  // Words in quotation marks are words to paint.
  /["“”][^"“”]*[A-Za-z]{2}[^"“”]*["“”]/,
];

/** The first phrase of the prompt that asks for words in the picture, or nothing. */
export function wordsAsked(prompt: string): string | undefined {
  for (const pattern of ASKS_FOR_WORDS) {
    const found = pattern.exec(prompt);
    if (found) return found[0].trim().slice(0, 60);
  }
  return undefined;
}

/**
 * Added once to every render prompt by the server. It carries the owner's picture rules that
 * hold for every ad, so no agent has to remember them and none can leave them out.
 */
export const RENDER_RULES =
  "Format: a 4:5 portrait photograph for a static ad. " +
  "No words, letters or numbers anywhere in the picture, except the print on the product itself and the brand logo. " +
  "No button, price, web address, caption, sign, handwriting or printed paper on a prop. " +
  "Keep the product from the reference picture exactly as it is: the same shape, the same proportions and the same print. " +
  "Every object keeps its real size next to the product, and rests on a surface with a contact shadow or is held in a hand; nothing floats. " +
  "No drip, spill or stain on the product or on a prop.";
