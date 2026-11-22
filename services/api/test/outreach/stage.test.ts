import { describe, expect, it } from "vitest";
import { adWaits, approvedAd, candidatesWait, channelOf, owedAnswer, owedByAgent, owedNow, refusedDrafts, stageOf, wantsAd } from "../../src/outreach/stage.js";
import { ad, event, file, profile, send } from "./helpers.js";

const none = new Set<string>();

describe("the stage of a prospect", () => {
  it("is new with nothing in its history", () => {
    expect(stageOf(file(), none)).toBe("new");
  });

  it("is no route with no number and no verified address", () => {
    expect(stageOf(file({ profile: profile(1, { whatsapp: [], email: undefined as never }) }), none)).toBe("no_route");
  });

  it("needs a service ad when it is marked as a service, and is new again when marked as a product", () => {
    const service = event({ type: "kind", kind: "service" }, "agent");
    expect(stageOf(file({ events: [service] }), none)).toBe("needs_service_ad");
    expect(stageOf(file({ events: [service, event({ type: "kind", kind: "product" })] }), none)).toBe("new");
  });

  it("waits for the owner when an ad is attached, and is ready after his yes", () => {
    const first = ad(1);
    expect(stageOf(file({ ads: [first] }), none)).toBe("ad_waits");
    expect(stageOf(file({ ads: [first], events: [event({ type: "ad_yes", ad: 1 })] }), none)).toBe("ready");
  });

  it("is new after his first no, and parked after his second", () => {
    const one = [event({ type: "ad_no", ad: 1, ownerSaid: "the pack is too small" })];
    expect(stageOf(file({ ads: [ad(1)], events: one }), none)).toBe("new");
    const second = ad(2);
    expect(stageOf(file({ ads: [ad(1), second], events: one }), none)).toBe("ad_waits");
    expect(stageOf(file({ ads: [ad(1), second], events: [...one, event({ type: "ad_no", ad: 2, ownerSaid: "still no" })] }), none)).toBe("parked");
  });

  it("is contacted after the first message, through both follow-ups", () => {
    const ready = { ads: [ad(1)], events: [event({ type: "ad_yes", ad: 1 })] };
    expect(stageOf(file({ ...ready, sends: [send(0)] }), none)).toBe("contacted");
    expect(stageOf(file({ ...ready, sends: [send(0), send(1, "2026-11-26"), send(2, "2026-11-30")] }), none)).toBe("contacted");
  });

  it("is replied after a reply, and keeps that stage when a new ad is attached", () => {
    const replied = file({ ads: [ad(1)], sends: [send(0)], events: [event({ type: "ad_yes", ad: 1 }), event({ type: "reply", reply: "more" })] });
    expect(stageOf(replied, none)).toBe("replied");
    const more = { ...replied, ads: [...replied.ads, ad(2)] };
    expect(stageOf(more, none)).toBe("replied");
    expect(adWaits(more)).toBe(true);
  });

  it("takes in talks, client, lost and parked from the owner, and gives the stage back on auto", () => {
    const base = { sends: [send(0)], events: [event({ type: "reply", reply: "other" })] };
    for (const stage of ["in_talks", "client", "lost", "parked"] as const) {
      expect(stageOf(file({ ...base, events: [...base.events, event({ type: "stage", stage })] }), none)).toBe(stage);
    }
    expect(stageOf(file({ ...base, events: [...base.events, event({ type: "stage", stage: "lost" }), event({ type: "stage", stage: "auto" })] }), none)).toBe("replied");
  });

  it("is parked when the agent parks it with a reason", () => {
    expect(stageOf(file({ events: [event({ type: "stage", stage: "parked", reason: "No usable real photo." }, "agent")] }), none)).toBe("parked");
  });

  it("is opted out above every other stage", () => {
    const client = [event({ type: "stage", stage: "client" }), event({ type: "optout" })];
    expect(stageOf(file({ sends: [send(0)], events: client }), none)).toBe("opted_out");
  });

  it("is opted out when another brand with the same number or the same address opted out", () => {
    expect(stageOf(file({ profile: profile(2, { whatsapp: ["6580000001"] }) }), new Set(["W#6580000001"]))).toBe("opted_out");
    expect(stageOf(file({ profile: profile(2, { email: "hello@brand1.example" }) }), new Set(["E#hello@brand1.example"]))).toBe("opted_out");
    expect(stageOf(file({ profile: profile(2) }), new Set(["W#6580000001"]))).toBe("new");
  });

  it("keeps the register away from a test prospect", () => {
    expect(stageOf(file({ profile: profile(2, { test: true, whatsapp: ["6580000001"] }) }), new Set(["W#6580000001"]))).toBe("new");
  });
});

describe("what a prospect needs next", () => {
  it("wants a first ad when it is new, and none while one waits or after a yes", () => {
    expect(wantsAd(file(), none)).toEqual({ why: "first" });
    expect(wantsAd(file({ ads: [ad(1)] }), none)).toBeUndefined();
    expect(wantsAd(file({ ads: [ad(1)], events: [event({ type: "ad_yes", ad: 1 })] }), none)).toBeUndefined();
  });

  it("wants one more ad after the owner's no, with his words, and none after the second no", () => {
    const no = event({ type: "ad_no", ad: 1, ownerSaid: "the pack is too small" });
    expect(wantsAd(file({ ads: [ad(1)], events: [no] }), none)).toEqual({ why: "again", ownerSaid: "the pack is too small" });
    expect(wantsAd(file({ ads: [ad(1), ad(2)], events: [no, event({ type: "ad_no", ad: 2, ownerSaid: "no" })] }), none)).toBeUndefined();
  });

  it("wants no ad for a service brand, a brand with no route, a parked one or an opted-out one", () => {
    expect(wantsAd(file({ events: [event({ type: "kind", kind: "service" })] }), none)).toBeUndefined();
    expect(wantsAd(file({ profile: profile(1, { whatsapp: [], email: undefined as never }) }), none)).toBeUndefined();
    expect(wantsAd(file({ events: [event({ type: "stage", stage: "parked" })] }), none)).toBeUndefined();
    expect(wantsAd(file({ events: [event({ type: "optout" })] }), none)).toBeUndefined();
  });

  it("wants one more ad after a more reply, and none once that ad is attached", () => {
    const first = ad(1);
    const base = { sends: [send(0)], events: [event({ type: "ad_yes", ad: 1 }), event({ type: "reply", reply: "more" as const })] };
    expect(wantsAd(file({ ...base, ads: [first] }), none)).toEqual({ why: "more" });
    expect(wantsAd(file({ ...base, ads: [first, ad(2)] }), none)).toBeUndefined();
  });

  it("owes an answer after a more reply until the owner logs his answer", () => {
    const more = event({ type: "reply", reply: "more" });
    expect(owedAnswer(file({ events: [more] }))).toBeDefined();
    expect(owedAnswer(file({ events: [more, event({ type: "answered" })] }))).toBeUndefined();
    expect(owedAnswer(file({ events: [event({ type: "reply", reply: "other" })] }))).toBeUndefined();
  });

  it("uses WhatsApp when there is a number, else the address, and the owner's choice when the brand has it", () => {
    expect(channelOf(file())).toBe("whatsapp");
    expect(channelOf(file({ profile: profile(1, { whatsapp: [] }) }))).toBe("email");
    expect(channelOf(file({ events: [event({ type: "channel", channel: "email" })] }))).toBe("email");
    expect(channelOf(file({ profile: profile(1, { whatsapp: [] }), events: [event({ type: "channel", channel: "whatsapp" })] }))).toBe("email");
  });
});

describe("the owner's pick among the drafts", () => {
  const shown = () => event({ type: "candidates", batchId: "batch-1", drafts: 9 }, "agent");
  const pick = (imageId = "draft-1") => event({ type: "pick", batchId: "batch-1", ideaId: "idea-1", imageId });
  const final = (n: number) => ({ ...ad(n), batchId: "batch-1", picked: true as const });

  it("waits for his pick once the drafts are shown, and the agent makes no other ad meanwhile", () => {
    const waiting = file({ events: [shown()] });
    expect(stageOf(waiting, none)).toBe("pick_waits");
    expect(candidatesWait(waiting)).toMatchObject({ batchId: "batch-1" });
    expect(owedByAgent(waiting)).toBeUndefined();
    expect(wantsAd(waiting, none)).toBeUndefined();
  });

  it("waits for the agent after his pick, and is ready when the final of that pick is attached: his pick is his yes", () => {
    const events = [shown(), pick()];
    const picked = file({ events });
    expect(stageOf(picked, none)).toBe("pick_made");
    expect(owedByAgent(picked)).toMatchObject({ type: "pick", imageId: "draft-1" });
    expect(wantsAd(picked, none)).toBeUndefined();
    const made = file({ events, ads: [final(1)] });
    expect(stageOf(made, none)).toBe("ready");
    expect(adWaits(made)).toBe(false);
    expect(approvedAd(made)).toMatchObject({ n: 1 });
    expect(owedByAgent(made)).toBeUndefined();
  });

  it("owes the final of his newest pick only", () => {
    const events = [shown(), pick("draft-1"), pick("draft-2")];
    expect(owedByAgent(file({ events }))).toMatchObject({ imageId: "draft-2" });
    const first = final(1);
    const again = pick("draft-3");
    expect(owedByAgent(file({ events: [...events, again], ads: [first] }))).toMatchObject({ imageId: "draft-3" });
  });

  it("goes back to the drafts after his no to the final of his pick, with no try used up", () => {
    const events = [shown(), pick()];
    const first = final(1);
    const refused = file({ events: [...events, event({ type: "ad_no", ad: 1, ownerSaid: "soft at full size" })], ads: [first] });
    expect(stageOf(refused, none)).toBe("pick_waits");
    expect(wantsAd(refused, none)).toBeUndefined();
    expect([...refusedDrafts(refused, "batch-1")]).toEqual(["draft-1"]);
    expect([...refusedDrafts(refused, "another-batch")]).toEqual([]);
  });

  it("is new with his words after one none, and parked after two", () => {
    const one = [shown(), event({ type: "none", batchId: "batch-1", ownerSaid: "the headline says nothing" })];
    expect(stageOf(file({ events: one }), none)).toBe("new");
    expect(wantsAd(file({ events: one }), none)).toEqual({ why: "again", ownerSaid: "the headline says nothing" });
    const two = [...one, event({ type: "candidates", batchId: "batch-2", drafts: 9 }, "agent"), event({ type: "none", batchId: "batch-2", ownerSaid: "still no" })];
    expect(stageOf(file({ events: two }), none)).toBe("parked");
    expect(wantsAd(file({ events: two }), none)).toBeUndefined();
  });

  it("counts a none and a no to an agent's ad together as the two tries", () => {
    const events = [event({ type: "ad_no", ad: 1, ownerSaid: "the pack is too small" }), shown(), event({ type: "none", batchId: "batch-1", ownerSaid: "no" })];
    expect(stageOf(file({ ads: [ad(1)], events }), none)).toBe("parked");
  });

  it("waits for the agent after he asks for other words, until the drafts are shown again", () => {
    const events = [shown(), event({ type: "words", batchId: "batch-1", ideaId: "idea-1", imageId: "draft-1", ownerSaid: "say the price" })];
    expect(stageOf(file({ events }), none)).toBe("pick_made");
    expect(owedByAgent(file({ events }))).toMatchObject({ type: "words", ownerSaid: "say the price" });
    const again = [...events, shown()];
    expect(stageOf(file({ events: again }), none)).toBe("pick_waits");
    expect(owedByAgent(file({ events: again }))).toBeUndefined();
  });

  it("keeps a brand the owner has written to at its stage, and still owes the final of a later pick", () => {
    const events = [shown(), pick()];
    const first = final(1);
    const later = pick("draft-2");
    const sent = file({ events: [...events, later], ads: [first], sends: [send(0)] });
    expect(stageOf(sent, none)).toBe("contacted");
    expect(owedByAgent(sent)).toMatchObject({ imageId: "draft-2" });
  });

  // His own picture, with the yes his upload carries, put on the page at this moment of the timeline.
  const own = (n: number) => {
    const yes = event({ type: "ad_yes", ad: n });
    return { ad: { ...ad(n), batchId: "owner", from: "owner" as const, at: yes.at }, yes };
  };

  it("is ready with the owner's own picture when he uploads it while the drafts wait: his upload answers them", () => {
    const drafts = shown();
    const upload = own(1);
    const uploaded = file({ events: [drafts, upload.yes], ads: [upload.ad] });
    expect(stageOf(uploaded, none)).toBe("ready");
    expect(candidatesWait(uploaded)).toBeUndefined();
    expect(approvedAd(uploaded)).toMatchObject({ from: "owner" });
    // His no to his own picture brings the drafts back.
    const taken = file({ events: [drafts, upload.yes, event({ type: "ad_no", ad: 1, ownerSaid: "the wrong file" })], ads: [upload.ad] });
    expect(stageOf(taken, none)).toBe("pick_waits");
  });

  it("owes no final and no other words once he uploads his own picture after his choice", () => {
    for (const choice of [pick(), event({ type: "words", batchId: "batch-1", ideaId: "idea-1", imageId: "draft-1", ownerSaid: "say the price" })]) {
      const drafts = shown();
      const upload = own(1);
      // The events of a file are in the order of their making here: the choice is made before the upload.
      const uploaded = file({ events: [drafts, { ...choice, at: drafts.at }, upload.yes], ads: [upload.ad] });
      expect(owedByAgent(uploaded)).toBeUndefined();
      expect(stageOf(uploaded, none)).toBe("ready");
      expect(wantsAd(uploaded, none)).toBeUndefined();
    }
  });

  it("keeps his own picture ready while the agent makes the final of a draft he picks after it", () => {
    const drafts = shown();
    const upload = own(1);
    const later = pick("draft-2");
    const picked = file({ events: [drafts, upload.yes, later], ads: [upload.ad] });
    expect(owedByAgent(picked)).toMatchObject({ imageId: "draft-2" });
    expect(stageOf(picked, none)).toBe("ready");
    const made = { ...final(2), at: event({ type: "kind", kind: "product" }, "agent").at };
    const done = file({ events: [drafts, upload.yes, later], ads: [upload.ad, made] });
    expect(owedByAgent(done)).toBeUndefined();
    expect(approvedAd(done)).toMatchObject({ n: 2, picked: true });
  });

  it("owes nothing now for a brand the owner parked or lost after his pick, or that opted out", () => {
    const events = [shown(), pick()];
    expect(owedNow(file({ events }), none)).toMatchObject({ imageId: "draft-1" });
    for (const stage of ["parked", "lost"] as const) {
      const stopped = file({ events: [...events, event({ type: "stage", stage })] });
      expect(owedNow(stopped, none)).toBeUndefined();
      expect(stageOf(stopped, none)).toBe(stage);
    }
    expect(owedNow(file({ events: [...events, event({ type: "optout" })] }), none)).toBeUndefined();
    // Back on auto, the pick is owed again.
    expect(owedNow(file({ events: [...events, event({ type: "stage", stage: "parked" }), event({ type: "stage", stage: "auto" })] }), none)).toMatchObject({ imageId: "draft-1" });
  });
});
