import { describe, expect, it } from "vitest";
import { approvedClient, callTool, createStudio, type Studio } from "../helpers/deps.js";
import { fakeNet } from "../helpers/net.js";
import { directionOf, PICKED, rules, v3AtWorded } from "../helpers/v3.js";

const SCENE = "One empty pouch lies flat on a yellow seamless, one hard shadow to its right, camera from above.";
const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0]);
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Archivo:wght@800";
const FONT_FILE = "https://fonts.gstatic.com/s/archivo/v19/archivo-800.ttf";

let studio: Studio;
let batchId: string;
let draft: string;

/** A v3 batch with one draft of idea-2, whose direction puts the words where `lockup` says. */
async function start(lockup: string) {
  studio = await createStudio({ net: fakeNet({ [FONT_CSS]: { body: `@font-face { font-family: 'Archivo'; src: url(${FONT_FILE}) format('truetype'); }` }, [FONT_FILE]: { body: TTF } }) });
  await approvedClient(studio);
  const made = await v3AtWorded(studio);
  batchId = made.batchId;
  const font = await callTool(studio, "font_save", { brandId: made.brand.id, family: "Archivo", weight: 800 });
  if (!font.ok) throw new Error(font.error);
  const saved = await callTool(studio, "direction_save", { ...rules, batchId, concepts: PICKED.map((ideaId) => directionOf(ideaId, { lockup })) });
  if (!saved.ok) throw new Error(saved.error);
  const sent = await callTool(studio, "render_submit", { ...rules, batchId, ideaId: "idea-2", kind: "draft", draft: 1, prompt: SCENE, references: ["pack-1"] });
  if (!sent.ok) throw new Error(sent.error);
  draft = (await callTool(studio, "render_status", { batchId, renderId: sent.value.id })).value.image.id;
}
const set = (extra: object) => callTool(studio, "type_set", { ...rules, batchId, imageId: draft, colour: "FFFFFF", ...extra });
const sent = () => studio.pixels.events.filter((entry) => entry.tool === "headline").at(-1)?.input;
const REFUSED = (place: RegExp) => ({ ok: false, error: expect.stringMatching(place) });

describe("the words of a concept ad", () => {
  it("stand in a column flush left, with the logo at the head of the column", async () => {
    await start("flush_left");
    expect(await set({ area: [0.55, 0.1, 0.94, 0.4], align: "right" })).toMatchObject(REFUSED(/The direction of idea-2 puts its words in a column flush left/));
    expect(await set({ area: [0.55, 0.1, 0.94, 0.4] })).toMatchObject(REFUSED(/in the left half/));
    expect(await set({ area: [0.06, 0.1, 0.5, 0.4], align: "center" })).toMatchObject(REFUSED(/align left/));
    expect((await set({ area: [0.06, 0.1, 0.5, 0.4], logoWidth: 0.16 })).ok).toBe(true);
    expect(sent()).toMatchObject({ align: "left", logoX: 0.06, logoWidth: 0.16, headline: "Gone again B" });
  });

  it("stand in a column flush right, with the logo on the column's right edge", async () => {
    await start("flush_right");
    expect(await set({ area: [0.06, 0.1, 0.5, 0.4] })).toMatchObject(REFUSED(/a column flush right/));
    expect(await set({ area: [0.06, 0.1, 0.5, 0.4], align: "right" })).toMatchObject(REFUSED(/in the right half/));
    expect((await set({ area: [0.5, 0.1, 0.94, 0.4], align: "right", logoWidth: 0.16 })).ok).toBe(true);
    expect(sent()).toMatchObject({ align: "right", logoX: 0.78 });
  });

  it("stand in a band at the top, on its left", async () => {
    await start("top_band_left");
    expect(await set({ area: [0.06, 0.4, 0.7, 0.7] })).toMatchObject(REFUSED(/a band at the top/));
    expect(await set({ area: [0.55, 0.06, 0.94, 0.3] })).toMatchObject(REFUSED(/starting in the left half/));
    expect((await set({ area: [0.06, 0.06, 0.8, 0.3] })).ok).toBe(true);
    expect(sent()).toMatchObject({ align: "left", logoX: 0.06 });
  });

  it("keep a logo place the agent gives, and take none with no logo", async () => {
    await start("flush_left");
    expect((await set({ area: [0.06, 0.1, 0.5, 0.4], logoX: 0.7 })).ok).toBe(true);
    expect(sent()).toMatchObject({ logoX: 0.7 });
    studio.clock.now = new Date(studio.clock.now.getTime() + 1000);
    expect((await set({ area: [0.06, 0.1, 0.5, 0.4], logo: false })).ok).toBe(true);
    expect(sent()).not.toHaveProperty("logoX");
  });

  it("keep the type rules of every ad with words", async () => {
    await start("flush_left");
    // The words are the owner's: the caller cannot type them.
    expect((await set({ area: [0.06, 0.1, 0.5, 0.4], headline: "FREE TODAY" })).ok).toBe(false);
    // The subline is 0.2 of the headline or more.
    expect((await set({ area: [0.06, 0.1, 0.5, 0.4], subRatio: 0.1 })).ok).toBe(false);
  });
});
