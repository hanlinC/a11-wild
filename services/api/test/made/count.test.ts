import { describe, expect, it } from "vitest";
import { MADE_BEFORE, MadeCount } from "../../src/made/count.js";
import { createStudio, json, sessionCookie } from "../helpers/deps.js";
import { MemoryTable } from "../helpers/memory-table.js";

describe("the count of the pictures made", () => {
  it("starts at what the two accounts had made before, and goes up by one a picture", async () => {
    const count = new MadeCount(new MemoryTable(), { count: async () => 18 });
    expect(await count.read()).toEqual({ images: MADE_BEFORE, chosen: 18 });
    await Promise.all([count.one(), count.one()]);
    expect(await count.read()).toEqual({ images: MADE_BEFORE + 2, chosen: 18 });
  });

  it("is read by the owner alone", async () => {
    const studio = await createStudio();
    const get = (cookie?: string) => studio.app.request("/api/made", cookie ? { headers: { cookie } } : {});
    expect((await get()).status).toBe(401);
    expect((await get(await sessionCookie(studio, "member"))).status).toBe(403);
    expect(await json(await get(await sessionCookie(studio)))).toEqual({ images: MADE_BEFORE, chosen: 0 });
  });
});
