import { describe, expect, it } from "vitest";
import { PickStore } from "../../src/picks/store.js";
import { MemoryTable } from "../helpers/memory-table.js";

/** A table whose first read waits for a turn, as when two saves read before either writes. */
class ReadsBeforeTheOtherWrites extends MemoryTable {
  private waits = 2;
  override async get<T extends Parameters<MemoryTable["put"]>[0]>(pk: string, sk: string) {
    const found = await super.get<T>(pk, sk);
    if (this.waits-- > 0) await new Promise((resolve) => setTimeout(resolve, 5));
    return found;
  }
}

describe("the pick store", () => {
  it("keeps his first choice when two first choices for one idea are saved at the same time", async () => {
    let tick = 0;
    const picks = new PickStore(new ReadsBeforeTheOtherWrites(), () => new Date(Date.UTC(2026, 10, 22, 0, 0, tick++)));
    const choice = (imageId: string) => ({ ideaId: "idea-1", imageId, shownId: imageId, ownerSaid: "This one.", by: "owner@example.com" });
    const [one, two] = await Promise.all([picks.save("b1", choice("d1")), picks.save("b1", choice("d2"))]);
    expect(one.first).toBeUndefined();
    expect(two).toMatchObject({ imageId: "d2", first: { imageId: "d1", shownId: "d1", at: one.at } });
    expect(await picks.all("b1")).toEqual([two]);
  });
});
