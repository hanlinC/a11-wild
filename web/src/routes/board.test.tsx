import type { Board as BoardData, BoardDraft } from "@a11-wild/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { MEMBER, renderSignedIn, stubApi } from "@/test-helpers";
import { Board } from "./board";

const at = "2026-11-22T03:00:00.000Z";
const draft = (ideaId: string, number: number, items: BoardDraft["checks"] = { imageId: "", items: [], looked: true, savedAt: at }): BoardDraft => {
  const image = { id: `${ideaId}-d${number}`, batchId: "b1", kind: "draft" as const, key: `batches/b1/drafts/${ideaId}-d${number}.jpg`, ideaId, createdAt: at };
  return { number, image, shown: image, viewUrl: `https://pictures.example/${ideaId}-d${number}.jpg`, checks: items };
};
const idea = (n: number) => ({
  id: `idea-${n}`,
  title: `Rock ${n}`,
  visual: "The pack stands alone on a wet rock.",
  device: "The pack as a rock",
  focalPoint: "The pack",
  elements: ["pack", "rock"],
  references: [],
  coverTest: { passed: true, note: "Only this brand." },
  killTest: { passed: true, note: "Real pack." },
});
const board = (overrides: Partial<BoardData> = {}): BoardData => ({
  batch: { id: "b1", kind: "v1", brandId: "br1", productId: "p1", format: "static_4x5", state: "waiting_pick", truthVersion: 2, createdAt: at, updatedAt: at, createdBy: "owner@example.com" },
  picking: "open",
  brand: { id: "br1", name: "WonGi" },
  product: { id: "p1", name: "Seaweed crisps" },
  truthSheet: { productId: "p1", version: 2, shape: "A flat pouch with a zip top.", packaging: "Matt black pouch.", measures: [{ name: "pack height", value: 180, unit: "mm", status: "unverified" }], savedAt: at, savedBy: "owner@example.com" },
  ideas: [
    {
      idea: idea(1),
      drafts: [draft("idea-1", 1), draft("idea-1", 2, { imageId: "idea-1-d2", items: [{ code: "D11", note: "The pouch is 5% wider than the packshot.", tool: "pack_check" }], looked: true, savedAt: at }), draft("idea-1", 3)],
      pick: null,
      rank: null,
      finals: [],
    },
    { idea: idea(2), drafts: [draft("idea-2", 1), draft("idea-2", 2), draft("idea-2", 3)], pick: null, rank: null, finals: [] },
  ],
  ...overrides,
});

function show(page: BoardData, me?: typeof MEMBER) {
  const sent: unknown[] = [];
  stubApi({
    "GET /api/batches/b1/board": () => ({ body: page }),
    "POST /api/batches/b1/picks": (body) => {
      sent.push(body);
      return { body: { pick: { ideaId: "idea-1", imageId: "idea-1-d3", ownerSaid: "calm", at, by: "owner@example.com" } } };
    },
  });
  renderSignedIn(
    <Routes>
      <Route path="batches/:batchId" element={<Board />} />
    </Routes>,
    me,
    "/batches/b1",
  );
  return sent;
}

describe("Pick board", () => {
  it("shows each idea's three drafts numbered 1 to 3 in order, with no rank, beside the truth sheet", async () => {
    show(board());
    const first = (await screen.findByRole("heading", { name: "Idea 1: Rock 1" })).closest("section")!;
    const pictures = within(first).getAllByRole("img");
    expect(pictures.map((img) => img.getAttribute("alt"))).toEqual(["Rock 1, draft 1", "Rock 1, draft 2", "Rock 1, draft 3"]);
    expect(screen.getByText("Truth sheet version 2")).toBeInTheDocument();
    expect(screen.getByText("unverified")).toBeInTheDocument();
    // Inside an idea nothing orders the drafts but their numbers.
    expect(first.textContent).not.toMatch(/rank|score|best|recommended/i);
  });

  it("names a D item on the draft that has it, and says when it was measured", async () => {
    show(board());
    const second = (await screen.findByAltText("Rock 1, draft 2")).closest("li")!;
    expect(within(second).getByText("D11")).toBeInTheDocument();
    expect(within(second).getByText(/5% wider than the packshot/)).toBeInTheDocument();
    expect(within(second).getByText("(measured)")).toBeInTheDocument();
  });

  it("saves the owner's pick with his own words", async () => {
    const sent = show(board());
    const first = (await screen.findByRole("heading", { name: "Idea 1: Rock 1" })).closest("section")!;
    await userEvent.click(within(first).getByRole("button", { name: "Pick draft 3" }));
    await userEvent.type(within(first).getByLabelText("Why draft 3, in your own words"), "calm");
    await userEvent.click(within(first).getByRole("button", { name: "Save the pick" }));
    await waitFor(() => expect(sent).toEqual([{ ideaId: "idea-1", imageId: "idea-1-d3", ownerSaid: "calm" }]));
  });

  it("marks a test batch, so its picks are not read as the owner's", async () => {
    show(board({ batch: { ...board().batch, test: true } }));
    expect(await screen.findByText("Test batch: not the owner's picks")).toBeInTheDocument();
  });

  it("shows an ad with words as it is delivered: the picture with the approved words, and the words as text", async () => {
    const withWords = { ...draft("idea-1", 1), words: { image: { ...draft("idea-1", 1).image, id: "idea-1-t1", kind: "typeset" as const }, viewUrl: "https://pictures.example/typeset-1.jpg", checks: { imageId: "idea-1-t1", looked: true, items: [{ code: "F3" as const, note: "The subline sits close to the pack." }], savedAt: at } } };
    const copy = { ideaId: "idea-1", headline: "ONCE YOU | START.", subline: "You cannot stop.", ownerSaid: "yes", version: 1, at, by: "owner@example.com" };
    show(board({ batch: { ...board().batch, kind: "v2" }, ideas: [{ idea: idea(1), copy, drafts: [withWords, draft("idea-1", 2)], pick: null, rank: null, finals: [] }] }));
    expect(await screen.findByText("ONCE YOU START.")).toBeInTheDocument();
    expect(screen.getByText("You cannot stop.")).toBeInTheDocument();
    expect(screen.getByText("Headline ad")).toBeInTheDocument();
    expect(screen.getByAltText("Rock 1, draft 1")).toHaveAttribute("src", "https://pictures.example/typeset-1.jpg");
    expect(screen.getAllByText("Words set")).toHaveLength(1);
    // What was found in the picture with its words is shown beside it.
    expect(screen.getByText("The subline sits close to the pack.")).toBeInTheDocument();
  });

  it("saves a pass on all three, and shows a saved pick in the owner's words", async () => {
    const sent = show(board({ ideas: [{ idea: idea(1), drafts: [draft("idea-1", 1), draft("idea-1", 2), draft("idea-1", 3)], pick: { ideaId: "idea-1", imageId: "idea-1-d2", ownerSaid: "the rock reads at once", at, by: "owner@example.com" }, rank: null, finals: [] }] }));
    expect(await screen.findByText(/You picked draft 2/)).toHaveTextContent("the rock reads at once");
    expect(screen.getByText("Your pick")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pass on all 3" }));
    await userEvent.type(screen.getByLabelText("Why none of them, in your own words"), "too busy");
    await userEvent.click(screen.getByRole("button", { name: "Save the pass" }));
    await waitFor(() => expect(sent).toEqual([{ ideaId: "idea-1", imageId: null, ownerSaid: "too busy" }]));
  });

  it("shows a final after its real-camera finish, and says when a draft was repaired", async () => {
    const made = draft("idea-1", 1);
    const repair = { ...made.image, id: "swap-1", kind: "swap" as const, rootId: made.image.id };
    const final = { ...made.image, id: "final-1", kind: "final" as const };
    const finish = { ...made.image, id: "finish-1", kind: "finish" as const, rootId: "final-1" };
    show(
      board({
        ideas: [
          {
            idea: idea(1),
            drafts: [{ ...made, shown: repair, viewUrl: "https://pictures.example/swap-1.jpg" }],
            pick: null,
            rank: null,
            finals: [{ number: 1, image: final, shown: final, viewUrl: "https://pictures.example/final-1.jpg", checks: null, finish: { image: finish, viewUrl: "https://pictures.example/finish-1.jpg" } }],
          },
        ],
      }),
    );
    expect(await screen.findByAltText("Rock 1, draft 1")).toHaveAttribute("src", "https://pictures.example/swap-1.jpg");
    expect(screen.getByText("Repaired")).toBeInTheDocument();
    expect(screen.getByAltText("Rock 1, final 1")).toHaveAttribute("src", "https://pictures.example/finish-1.jpg");
    expect(screen.getByText("Finished")).toBeInTheDocument();
  });

  it("gives the owner no way to pick before the drafts are all made and checked, and says so", async () => {
    const page = board({ picking: "not_yet" });
    show({ ...page, batch: { ...page.batch, state: "priced" } });
    await screen.findByAltText("Rock 1, draft 1");
    expect(screen.getByText(/Not ready for your pick yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pick draft|Pass on all/ })).not.toBeInTheDocument();
  });

  it("closes the picks of a finished batch", async () => {
    show(board({ picking: "closed" }));
    await screen.findByAltText("Rock 1, draft 1");
    expect(screen.getByText(/Its picks are closed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pick draft|Pass on all/ })).not.toBeInTheDocument();
  });

  it("shows where the blind critic put each draft, once the owner has picked", async () => {
    const drafts = [draft("idea-1", 1), draft("idea-1", 2), draft("idea-1", 3)];
    const rank = { ideaId: "idea-1", at, order: [{ imageId: "idea-1-d3", shownId: "idea-1-d3", reason: "The calmest of the three." }, { imageId: "idea-1-d1", shownId: "idea-1-d1", reason: "The wave pulls the eye away." }, { imageId: "idea-1-d2", shownId: "idea-1-d2", reason: "The pouch is too wide." }] };
    show(board({ ideas: [{ idea: idea(1), drafts, pick: { ideaId: "idea-1", imageId: "idea-1-d1", ownerSaid: "the wave", at, by: "owner@example.com" }, rank, finals: [] }] }));
    const third = (await screen.findByAltText("Rock 1, draft 3")).closest("li")!;
    expect(within(third).getByText("The blind critic put it first: The calmest of the three.")).toBeInTheDocument();
    expect(within(screen.getByAltText("Rock 1, draft 1").closest("li")!).getByText(/put it second/)).toBeInTheDocument();
  });

  it("shows the done gate of a batch at its finals: each condition, its evidence and the stranger test", async () => {
    const page = board();
    stubApi({
      "GET /api/batches/b1/board": () => ({ body: { ...page, batch: { ...page.batch, state: "finals" } } }),
      "GET /api/batches/b1/done": () => ({
        body: {
          batch: page.batch,
          done: false,
          conditions: [
            { name: "picks", asks: "The owner has picked one draft for each idea.", passed: false, evidence: "idea-2: no pick yet" },
            { name: "finals", asks: "Each pick became a final with no D item, and its shape matches the real product.", passed: true, evidence: "1 final(s): each is checked." },
          ],
          strangerTest: ["Show each final, alone, to a person who does not know the brand."],
        },
      }),
    });
    renderSignedIn(
      <Routes>
        <Route path="batches/:batchId" element={<Board />} />
      </Routes>,
      undefined,
      "/batches/b1",
    );
    const gate = (await screen.findByRole("heading", { name: "Done gate" })).closest("section")!;
    expect(await within(gate).findByText("This batch is not done yet.")).toBeInTheDocument();
    expect(within(gate).getByText("idea-2: no pick yet")).toBeInTheDocument();
    expect(within(gate).getByText("Not met")).toBeInTheDocument();
    expect(within(gate).getByText("Met")).toBeInTheDocument();
    expect(within(gate).getByText(/person who does not know the brand/)).toBeInTheDocument();
  });

  it("reads the done gate again after the owner's pick", async () => {
    const page = board();
    const gate = (evidence: string, passed: boolean) => ({
      body: { batch: page.batch, done: false, conditions: [{ name: "picks", asks: "The owner has picked one draft for each idea.", passed, evidence }], strangerTest: [] },
    });
    let picked = false;
    stubApi({
      "GET /api/batches/b1/board": () => ({ body: { ...page, batch: { ...page.batch, state: "finals" } } }),
      "GET /api/batches/b1/done": () => (picked ? gate("2 idea(s): each has a pick.", true) : gate("idea-1: no pick yet", false)),
      "POST /api/batches/b1/picks": () => {
        picked = true;
        return { body: { pick: { ideaId: "idea-1", imageId: "idea-1-d3", ownerSaid: "calm", at, by: "owner@example.com" } } };
      },
    });
    renderSignedIn(
      <Routes>
        <Route path="batches/:batchId" element={<Board />} />
      </Routes>,
      undefined,
      "/batches/b1",
    );
    expect(await screen.findByText("idea-1: no pick yet")).toBeInTheDocument();
    const first = screen.getByRole("heading", { name: "Idea 1: Rock 1" }).closest("section")!;
    await userEvent.click(within(first).getByRole("button", { name: "Pick draft 3" }));
    await userEvent.type(within(first).getByLabelText("Why draft 3, in your own words"), "calm");
    await userEvent.click(within(first).getByRole("button", { name: "Save the pick" }));
    expect(await screen.findByText("2 idea(s): each has a pick.")).toBeInTheDocument();
    expect(screen.queryByText("idea-1: no pick yet")).not.toBeInTheDocument();
  });

  it("gives a member no way to pick", async () => {
    show(board(), MEMBER);
    await screen.findByAltText("Rock 1, draft 1");
    expect(screen.queryByRole("button", { name: /Pick draft|Pass on all/ })).not.toBeInTheDocument();
  });
});
