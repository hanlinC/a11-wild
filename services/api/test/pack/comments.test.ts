import { COMMENTS_MAX, type MetaVariant } from "@a11-wild/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { activityMessage, NOTICE_GAP_MS } from "../../src/notify.js";
import { createStudio, type Studio } from "../helpers/deps.js";
import { JPEG } from "../helpers/pictures.js";

const OWNER = "owner@example.com";
const variant = (headline: string): MetaVariant => ({ primary: "One cake holds ten flavours. Order yours today.", headline, description: "Ten flavours in one cake", cta: "Order Now" });
const AD = "a11_cake_tof";

let studio: Studio;
let brandId: string;

async function carried(example = false) {
  const { carryId } = await studio.services.pack.carryStart([{ type: "image/jpeg", bytes: JPEG.length }]);
  await studio.pictures.put(`carried/${carryId}/0`, JPEG, "image/jpeg");
  const made = await studio.services.pack.carry(OWNER, {
    carryId,
    brandId,
    product: "Cake",
    ads: [{ adName: AD, picture: 0, variants: [variant("A"), variant("B")], why: "Why.", claims: [] }],
    launchPlan: ["Run for 72 hours."],
    ...(example ? { example: { note: "Example. Not a client.", comments: [{ text: "An example comment." }] } } : {}),
  });
  const token = new URL(made.link).pathname.split("/").at(-1) as string;
  const pack = await studio.services.packs.get(made.packId);
  if (!pack) throw new Error("no pack");
  const version = await studio.services.pack.current(pack);
  if (!version) throw new Error("no version");
  return { token, pack, version };
}
type Carried = Awaited<ReturnType<typeof carried>>;
const send = (to: Carried, input: { text: unknown; adName?: unknown; change?: unknown }) => studio.services.comments.send(to.pack, to.version, input);
const step = (ms: number) => {
  studio.clock.now = new Date(studio.clock.now.getTime() + ms);
};

beforeEach(async () => {
  studio = await createStudio();
  brandId = (await studio.services.brands.saveBrand({ name: "WonGi", url: "https://wongi.example/", logo: null, palette: [], fonts: [], savedBy: OWNER })).id;
});

describe("a client's comments", () => {
  it("saves a comment on the pack and one on an ad, and the page shows them oldest first without their ids", async () => {
    const pack = await carried();
    await send(pack, { text: "  Looks great.  " });
    step(1000);
    await send(pack, { text: "Run this one first.", adName: AD });
    const view = await studio.services.pack.view(pack.token);
    expect(view?.comments).toEqual([
      { text: "Looks great.", at: expect.any(String) },
      { text: "Run this one first.", adName: AD, at: expect.any(String) },
    ]);
    expect(await studio.services.comments.all(pack.pack.id)).toMatchObject([{ id: expect.any(String) }, { id: expect.any(String), adName: AD }]);
  });

  it("refuses an empty comment, one that is too long, one that is no text and one on an ad the pack does not hold", async () => {
    const pack = await carried();
    for (const text of ["", "   ", "\u0000\u0007", "x".repeat(1001), 7, null, { text: "x" }]) await expect(send(pack, { text })).rejects.toThrow(/A comment/);
    await expect(send(pack, { text: "Hello", adName: "a11_other" })).rejects.toThrow(/no such ad/);
    await expect(send(pack, { text: "Hello", adName: 3 })).rejects.toThrow(/no such ad/);
    expect(await send(pack, { text: "x".repeat(1000) })).toMatchObject({ text: "x".repeat(1000) });
  });

  it("keeps markup as the same text, and drops control characters and direction marks", async () => {
    const pack = await carried();
    const markup = '<script>alert(1)</script> <img src=x onerror=alert(1)> =HYPERLINK("https://evil.example")';
    expect((await send(pack, { text: markup })).text).toBe(markup);
    expect((await send(pack, { text: "line one\r\nline\u0000 two\u202e\u2066\u001b[31m" })).text).toBe("line one\nline two[31m");
  });

  it("refuses the 51st comment of a pack, also when two arrive together", async () => {
    const pack = await carried();
    for (let index = 0; index < COMMENTS_MAX - 1; index++) await send(pack, { text: `Comment ${index}` });
    const last = await Promise.allSettled([send(pack, { text: "A" }), send(pack, { text: "B" })]);
    expect(last.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(send(pack, { text: "One more" })).rejects.toThrow(/its fill/);
    expect(await studio.services.comments.all(pack.pack.id)).toHaveLength(COMMENTS_MAX);
  });

  it("takes nothing on an example, and the example shows its own comments only", async () => {
    const example = await carried(true);
    await expect(send(example, { text: "Hello" })).rejects.toThrow(/example\. It takes no comment/);
    await expect(send(example, { text: "Hello", adName: AD, change: "words" })).rejects.toThrow(/example/);
    const view = await studio.services.pack.view(example.token);
    expect(view?.example?.comments).toEqual([{ text: "An example comment." }]);
    expect(view).not.toHaveProperty("comments");
    expect(await studio.services.comments.all(example.pack.id)).toEqual([]);
    expect(studio.activities).toEqual([]);
  });

  it("hides a comment from the client's page and keeps it for the owner", async () => {
    const pack = await carried();
    await send(pack, { text: "Rude words." });
    const [comment] = await studio.services.comments.all(pack.pack.id);
    expect(await studio.services.comments.hide(pack.pack.id, comment?.id as string, true)).toMatchObject({ hidden: true });
    expect((await studio.services.pack.view(pack.token))?.comments).toEqual([]);
    expect(await studio.services.comments.all(pack.pack.id)).toMatchObject([{ text: "Rude words.", hidden: true }]);
    expect(await studio.services.comments.hide(pack.pack.id, comment?.id as string, false)).not.toHaveProperty("hidden");
    expect((await studio.services.pack.view(pack.token))?.comments).toHaveLength(1);
    for (const id of ["nope", "00000000-0000-4000-8000-000000000000", "COUNT"]) await expect(studio.services.comments.hide(pack.pack.id, id, true)).rejects.toThrow(/no such comment/);
  });
});

describe("a change request", () => {
  it("is a comment on one ad with a kind, and starts as received", async () => {
    const pack = await carried();
    expect(await send(pack, { text: "Make the price bigger.", adName: AD, change: "offer" })).toEqual({ text: "Make the price bigger.", adName: AD, change: { what: "offer", status: "received" }, at: expect.any(String) });
    await expect(send(pack, { text: "Change it.", change: "words" })).rejects.toThrow(/names the ad/);
    for (const change of ["everything", "", 1, { what: "words" }]) await expect(send(pack, { text: "Change it.", adName: AD, change })).rejects.toThrow(/A change is one of/);
  });

  it("takes the status the owner sets, and done keeps the pack's version of that moment", async () => {
    const pack = await carried();
    await send(pack, { text: "Make the price bigger.", adName: AD, change: "offer" });
    step(1000);
    await send(pack, { text: "A plain comment." });
    const [request, plain] = await studio.services.comments.all(pack.pack.id);
    const set = (status: unknown, id = request?.id as string) => studio.services.comments.setStatus(pack.pack, id, status);
    expect((await set("in_work")).change).toEqual({ what: "offer", status: "in_work" });
    expect((await set("done")).change).toEqual({ what: "offer", status: "done", version: 1 });
    expect((await studio.services.pack.view(pack.token))?.comments?.[0]?.change).toEqual({ what: "offer", status: "done", version: 1 });
    expect((await set("declined")).change).toEqual({ what: "offer", status: "declined" });
    await expect(set("finished")).rejects.toThrow(/A status is one of/);
    await expect(set("done", plain?.id as string)).rejects.toThrow(/no change request/);
    await expect(set("done", "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/no such comment/);
    // The client cannot set a status: what they send is always received.
    expect((await send(pack, { text: "Again.", adName: AD, change: { what: "words", status: "done" } as never }).catch((error: Error) => error.message))).toMatch(/A change is one of/);
  });
});

describe("the notice to the owner", () => {
  it("says who and what, with a link to the dashboard, and holds nothing the client wrote", async () => {
    const pack = await carried();
    await send(pack, { text: "SECRET-WORDS in the comment" });
    expect(studio.activities).toEqual([{ brandId, brand: "WonGi", kind: "comment" }]);
    const { subject, body } = activityMessage(studio.activities[0] as never, "https://studio.example");
    expect(subject).toBe("a11 wild: WonGi sent a comment");
    expect(body).toContain("https://studio.example/clients\n");
    expect(subject + body).not.toContain("SECRET-WORDS");
    const long = activityMessage({ brandId, brand: `Café\nbreak ${"x".repeat(200)}`, kind: "change" }, "https://studio.example").subject;
    expect(long).toMatch(/^a11 wild: Cafe break x+ asked for a change to an ad$/);
    expect(long.length).toBeLessThan(100);
    expect(activityMessage({ brandId, brand: "猫", kind: "file" }, "https://studio.example").subject).toBe("a11 wild: a client sent a results file");
  });

  it("sends one email when several comments arrive at the same moment", async () => {
    const pack = await carried();
    await Promise.all(["One", "Two", "Three", "Four"].map((text) => send(pack, { text })));
    expect(studio.activities).toHaveLength(1);
  });

  it("points the owner to the Clients page, the one page that shows it", () => {
    expect(activityMessage({ brandId, brand: "WonGi", kind: "comment" }, "https://studio.example").body).toContain("Read it in the dashboard: https://studio.example/clients\n");
  });

  it("sends one email for a brand in ten minutes, and the next after that", async () => {
    const pack = await carried();
    await send(pack, { text: "One" });
    await send(pack, { text: "Two", adName: AD, change: "words" });
    step(NOTICE_GAP_MS - 1000);
    await send(pack, { text: "Three" });
    expect(studio.activities).toHaveLength(1);
    step(2000);
    await send(pack, { text: "Four", adName: AD, change: "picture" });
    expect(studio.activities).toEqual([
      { brandId, brand: "WonGi", kind: "comment" },
      { brandId, brand: "WonGi", kind: "change" },
    ]);
  });

  it("does not fail the comment when the email fails", async () => {
    const pack = await carried();
    studio.notifier.fails = true;
    expect(await send(pack, { text: "Saved all the same." })).toMatchObject({ text: "Saved all the same." });
    expect(await studio.services.comments.all(pack.pack.id)).toHaveLength(1);
  });
});
