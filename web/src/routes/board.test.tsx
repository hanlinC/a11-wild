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
  batch: { id: "b1", brandId: "br1", productId: "p1", format: "static_4x5", state: "waiting_pick", truthVersion: 2, createdAt: at, updatedAt: at, createdBy: "owner@example.com" },
  picking: "open",
  brand: { id: "br1", name: "WonGi" },
  product: { id: "p1", name: "Seaweed crisps" },
  truthSheet: { productId: "p1", version: 2, shape: "A flat pouch with a zip top.", packaging: "Matt black pouch.", measures: [{ name: "pack height", value: 180, unit: "mm", status: "unverified" }], savedAt: at, savedBy: "owner@example.com" },
  ideas: [
    {
      idea: idea(1),
      drafts: [draft("idea-1", 1), draft("idea-1", 2, { imageId: "idea-1-d2", items: [{ code: "D11", note: "The pouch is 5% wider than the packshot.", tool: "pack_check" }], looked: true, savedAt: at }), draft("idea-1", 3)],
      pick: null,
      finals: [],
    },
    { idea: idea(2), drafts: [draft("idea-2", 1), draft("idea-2", 2), draft("idea-2", 3)], pick: null, finals: [] },
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

  it("saves a pass on all three, and shows a saved pick in the owner's words", async () => {
    const sent = show(board({ ideas: [{ idea: idea(1), drafts: [draft("idea-1", 1), draft("idea-1", 2), draft("idea-1", 3)], pick: { ideaId: "idea-1", imageId: "idea-1-d2", ownerSaid: "the rock reads at once", at, by: "owner@example.com" }, finals: [] }] }));
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

  it("gives a member no way to pick", async () => {
    show(board(), MEMBER);
    await screen.findByAltText("Rock 1, draft 1");
    expect(screen.queryByRole("button", { name: /Pick draft|Pass on all/ })).not.toBeInTheDocument();
  });
});
