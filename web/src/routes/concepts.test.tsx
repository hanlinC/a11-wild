import type { ConceptBoard, ConceptReview, Idea } from "@a11-wild/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { MEMBER, renderSignedIn, stubApi } from "@/test-helpers";
import { Concepts } from "./concepts";

const at = "2026-11-22T03:00:00.000Z";
const TERRITORIES = ["Gone before home", "Hidden pack"];
const concept = (n: number): Idea => ({
  id: `idea-${n}`,
  title: `Empty pack ${n}`,
  visual: "One empty pouch lies flat on a yellow seamless.",
  device: "The empty pack as a full stop",
  focalPoint: "The empty pouch",
  elements: ["pouch", "shadow"],
  references: [],
  coverTest: { passed: true, note: "Someone finished the pack." },
  killTest: { passed: true, note: "Real pack." },
  stage: (["tof", "mof", "bof"] as const)[n % 3]!,
  headline: `Gone | again ${n}`,
  subline: "It never reaches home.",
  concept: {
    territory: TERRITORIES[n % 2]!,
    insightId: `insight-${(n % 2) + 1}`,
    proposition: "You will not share it.",
    mechanism: { type: "product state", how: "The empty pack ends the sentence." },
    productRole: "The empty pouch is the proof.",
    brandRole: "The brand's yellow.",
    sublineBasis: { kind: "second_beat" },
    pictureAlone: "Someone finished the pack.",
    headlineAlone: "Something keeps running out.",
    risks: [],
  },
});
const review = (ideaId: string, extra: Partial<ConceptReview> = {}): ConceptReview => ({
  ideaId,
  scores: { originality: 4, appropriateness: 4, insight: 4, headline: 3, visual: 5, product: 4, brand: 4, commercial: 4, execution: 4 },
  pointTest: { passed: true, note: "It points at the empty pouch." },
  localTruth: { passed: true, note: "People finish it in the car." },
  coverTest: { passed: false, note: "Without the line it is only litter." },
  wouldPay: true,
  recommend: false,
  note: `The pouch of ${ideaId} reads at once.`,
  roughs: [`${ideaId}-r1`],
  ...extra,
});
const board = (overrides: Partial<ConceptBoard> = {}): ConceptBoard => ({
  batch: { id: "b1", kind: "v3", brandId: "br1", productId: "p1", format: "static_4x5", state: "reviewed", truthVersion: 2, createdAt: at, updatedAt: at, createdBy: "owner@example.com" },
  brand: { id: "br1", name: "WonGi" },
  product: { id: "p1", name: "Seaweed crisps" },
  insights: [
    { id: "insight-1", text: "People hide the last pack.", basis: "evidence", sourceUrl: "https://forum.example/1", quote: "I keep one behind the rice." },
    { id: "insight-2", text: "It is eaten at the desk at four.", basis: "hypothesis" },
  ],
  picking: "open",
  reviewedAt: at,
  concepts: [1, 2, 3, 4].map((n) => ({
    idea: concept(n),
    roughs: n === 4 ? [] : [{ imageId: `idea-${n}-r1`, viewUrl: `https://pictures.example/idea-${n}-r1.jpg` }],
    review: review(`idea-${n}`, n === 2 ? { recommend: true } : n === 4 ? { roughs: [] } : {}),
  })),
  pick: null,
  ...overrides,
});

function show(page: ConceptBoard, me?: typeof MEMBER) {
  const sent: unknown[] = [];
  stubApi({
    "GET /api/batches/b1/concepts": () => ({ body: page }),
    "POST /api/batches/b1/concept-pick": (body) => {
      sent.push(body);
      return { body: { state: "judged" } };
    },
  });
  renderSignedIn(
    <Routes>
      <Route path="batches/:batchId/concepts" element={<Concepts />} />
    </Routes>,
    me,
    "/batches/b1/concepts",
  );
  return sent;
}
// The title of a picked concept is in "Your pick" too: its card is the last place.
const card = async (title: string) => (await screen.findAllByText(title)).at(-1)!.closest("li")!;

describe("Concept board", () => {
  it("shows every concept by territory, with its rough, its words and the critic's review", async () => {
    show(board());
    const hidden = (await screen.findByRole("heading", { name: /Hidden pack/ })).closest("section")!;
    expect(within(hidden).getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["Empty pack 1, rough 1", "Empty pack 3, rough 1"]);
    expect(within(hidden).getByText(/It is eaten at the desk at four/)).toBeInTheDocument();
    expect(within(hidden).getByText("A guess, no buyer said it")).toBeInTheDocument();

    const second = await card("Empty pack 2");
    expect(within(second).getByText("Gone again 2")).toBeInTheDocument();
    expect(within(second).getByText("It never reaches home.")).toBeInTheDocument();
    expect(within(second).getByText("The critic recommends it")).toBeInTheDocument();
    expect(within(second).getByText("The pouch of idea-2 reads at once.")).toBeInTheDocument();
    expect(within(second).getByText(/Without the line it is only litter/)).toBeInTheDocument();
    expect(second).toHaveTextContent("Picture 5/5");
    // A concept the critic did not recommend is shown in full too.
    const fourth = await card("Empty pack 4");
    expect(within(fourth).getByText("Not recommended")).toBeInTheDocument();
    expect(within(fourth).getByText("No rough: judged from its words.")).toBeInTheDocument();
  });

  it("saves the owner's three concepts with his own words, and no more than three", async () => {
    const sent = show(board());
    for (const n of [1, 2, 4]) await userEvent.click(within(await card(`Empty pack ${n}`)).getByRole("button", { name: "Choose this concept" }));
    expect(within(await card("Empty pack 3")).getByRole("button", { name: "Choose this concept" })).toBeDisabled();
    const save = screen.getByRole("button", { name: "Save my three concepts" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Why “Empty pack 1”, in your own words"), "stops me");
    await userEvent.type(screen.getByLabelText("Why “Empty pack 2”, in your own words"), "funny and true");
    await userEvent.type(screen.getByLabelText("Why “Empty pack 4”, in your own words"), "want to see it made");
    await userEvent.click(save);
    await waitFor(() =>
      expect(sent).toEqual([
        {
          picks: [
            { ideaId: "idea-1", ownerSaid: "stops me" },
            { ideaId: "idea-2", ownerSaid: "funny and true" },
            { ideaId: "idea-4", ownerSaid: "want to see it made" },
          ],
        },
      ]),
    );
  });

  it("shows a saved pick with his words and what he was told", async () => {
    show(
      board({
        batch: { ...board().batch, state: "judged" },
        pick: { picks: [1, 2, 4].map((n) => ({ ideaId: `idea-${n}`, ownerSaid: `yes ${n}` })), passes: [], warnings: ["idea-4 has no rough: he picked it from its words."], by: "owner@example.com", at },
      }),
    );
    const mine = (await screen.findByRole("heading", { name: "Your pick" })).closest("section")!;
    expect(within(mine).getByText("“yes 4”")).toBeInTheDocument();
    expect(within(mine).getByText(/idea-4 has no rough/)).toBeInTheDocument();
    expect(within(await card("Empty pack 2")).getByText("Your pick")).toBeInTheDocument();
  });

  it("gives a member no way to pick, and the owner none before the review or after the words", async () => {
    show(board(), MEMBER);
    await card("Empty pack 1");
    expect(screen.queryByRole("button", { name: "Choose this concept" })).toBeNull();
  });

  it("asks for the three before the concepts, and counts them as they are chosen", async () => {
    show(board());
    const step = await screen.findByRole("status");
    expect(step).toHaveTextContent("Asked of you");
    expect(step).toHaveTextContent("0 of 3 chosen");
    expect(step).toHaveTextContent("Pick three concepts");
    await userEvent.click(within(await card("Empty pack 1")).getByRole("button", { name: "Choose this concept" }));
    expect(step).toHaveTextContent("1 of 3 chosen");
  });

  it("says what is asked next once the three are saved", async () => {
    const saved = board({
      batch: { ...board().batch, state: "judged" },
      pick: { picks: [1, 2, 4].map((n) => ({ ideaId: `idea-${n}`, ownerSaid: `yes ${n}` })), passes: [], warnings: [], by: "owner@example.com", at },
    });
    show(saved);
    expect(await screen.findByRole("status")).toHaveTextContent("Say yes or no to the words of your three concepts. You answer your agent in chat.");
  });

  it("tells a member that the batch waits for the owner", async () => {
    show(board(), MEMBER);
    const step = await screen.findByRole("status");
    expect(step).toHaveTextContent("Nothing is asked of you");
    expect(step).toHaveTextContent("Waits for the owner.");
  });

  it("says when the critic has not reviewed the set as it is now", async () => {
    show(board({ picking: "not_yet", reviewedAt: null, concepts: board().concepts.map((entry) => ({ ...entry, review: null })) }));
    expect(await screen.findByText(/The critic has not reviewed every concept and rough as they are now/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose this concept" })).toBeNull();
    expect(screen.getAllByText("The critic has not reviewed it yet.")).toHaveLength(4);
  });
});
