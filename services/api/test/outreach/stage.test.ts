import { describe, expect, it } from "vitest";
import { adWaits, channelOf, owedAnswer, stageOf, wantsAd } from "../../src/outreach/stage.js";
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
