import type { ProposalView, TastePage } from "@a11-wild/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MEMBER, renderSignedIn, stubApi } from "@/test-helpers";
import { Taste } from "./taste";

const v1 = { version: 1, text: "One clever object.", reason: "First canon.", savedBy: "owner@example.com", savedAt: "2026-11-21T10:00:00.000Z" };
const page = (overrides: Partial<TastePage> = {}): TastePage => ({ canon: v1, versions: [{ ...v1, text: undefined } as never], log: [], swipe: [], canons: [], proposals: [], learning: [], ...overrides });
const none = { version: 0, text: "", reason: "", savedBy: "", savedAt: "" };
const craft = { scope: { kind: "craft" as const }, name: "Creative craft", canon: none, versions: [] };
const proposal = (overrides: Partial<ProposalView> = {}): ProposalView => ({
  id: "pr1",
  scope: { kind: "craft" },
  scopeName: "Creative craft",
  text: "No prop beside the food.",
  reason: "He passed on every prop.",
  recordIds: ["r1", "r2"],
  baseVersion: 0,
  status: "proposed",
  proposedBy: "agent@example.com",
  proposedAt: "2026-11-22T10:00:00.000Z",
  current: none,
  ...overrides,
});

/** The rules and the logs are folded: one row each, opened with a click. */
const open = async (name: RegExp) => userEvent.click(await screen.findByRole("button", { name }));
const CANON = /^Canon/;
const OTHER = /^Other rules/;

describe("Taste page", () => {
  it("leads with what waits, says so when nothing does, and keeps the rules and the logs folded", async () => {
    stubApi({ "GET /api/taste": () => ({ body: page({ canons: [craft], log: [{ id: "t1", at: "2026-11-21T10:00:00.000Z", kind: "pass", ownerSaid: "all three look like stock photos", savedBy: "owner@example.com" }] }) }) });
    renderSignedIn(<Taste />);
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing is asked of youNo change to a rule waits for a yes.");
    expect(screen.queryByRole("heading", { name: /Waiting for/ })).not.toBeInTheDocument();
    // Each fold says what it holds in a few words.
    expect(screen.getByRole("button", { name: CANON })).toHaveTextContent(/version 1, /);
    expect(screen.getByRole("button", { name: OTHER })).toHaveTextContent("0 written");
    expect(screen.getByRole("button", { name: /^Taste log\s*1$/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("One clever object.")).not.toBeInTheDocument();
    expect(screen.queryByText("all three look like stock photos")).not.toBeInTheDocument();
  });

  it("keeps a canon that is being edited when its row is closed and opened again", async () => {
    stubApi({ "GET /api/taste": () => ({ body: page() }) });
    renderSignedIn(<Taste />);
    await open(CANON);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("The whole canon"), " No clutter.");
    await open(CANON);
    expect(screen.getByLabelText("The whole canon")).not.toBeVisible();
    await open(CANON);
    expect(screen.getByLabelText("The whole canon")).toHaveValue("One clever object. No clutter.");
  });

  it("shows the canon, the owner's words in the log, and a saved reference", async () => {
    stubApi({
      "GET /api/taste": () => ({
        body: page({
          log: [{ id: "t1", at: "2026-11-21T10:00:00.000Z", kind: "pass", ownerSaid: "all three look like stock photos", savedBy: "owner@example.com" }],
          swipe: [{ id: "s1", title: "Lego shadow", why: "A brick casts the shadow of a ship.", source: "Blattner Brunner", addedAt: "2026-11-21T10:00:00.000Z", savedBy: "owner@example.com" }],
        }),
      }),
    });
    renderSignedIn(<Taste />);
    await open(CANON);
    await open(/^Taste log/);
    await open(/^Swipe file/);
    expect(await screen.findByText("One clever object.")).toBeInTheDocument();
    expect(screen.getByText("all three look like stock photos")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Lego shadow")).toBeInTheDocument();
  });

  it("saves an edit as a new version with its reason", async () => {
    let saved = false;
    const v2 = { ...v1, version: 2, text: "One clever object. No clutter.", reason: "He passed on a busy draft." };
    const calls = stubApi({
      "GET /api/taste": () => ({ body: saved ? page({ canon: v2, versions: [v2, v1] }) : page() }),
      "POST /api/taste/canon": () => {
        saved = true;
        return { body: v2 };
      },
    });
    renderSignedIn(<Taste />);
    await open(CANON);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("The whole canon"), " No clutter.");
    await userEvent.type(screen.getByLabelText("What changed, and why"), "He passed on a busy draft.");
    await userEvent.click(screen.getByRole("button", { name: "Save as version 2" }));

    await waitFor(() => expect(screen.getByText("One clever object. No clutter.")).toBeInTheDocument());
    expect(calls).toContain("POST /api/taste/canon");
    expect(screen.getByText(/Version 2 ·/)).toBeInTheDocument();
  });

  it("shows the studio's own words when a save is refused, and keeps the text", async () => {
    stubApi({
      "GET /api/taste": () => ({ body: page() }),
      "POST /api/taste/canon": () => ({ status: 400, body: { error: "refused", message: "A canon save needs a reason: one line on what changed and why." } }),
    });
    renderSignedIn(<Taste />);
    await open(CANON);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("What changed, and why"), " ");
    await userEvent.click(screen.getByRole("button", { name: "Save as version 2" }));
    expect(await screen.findByText(/needs a reason/)).toBeInTheDocument();
    expect(screen.getByLabelText("The whole canon")).toHaveValue("One clever object.");
  });

  it("reads an old version", async () => {
    const v2 = { ...v1, version: 2, text: "Newer.", reason: "Changed." };
    stubApi({ "GET /api/taste": () => ({ body: page({ canon: v2, versions: [v2, v1] }) }), "GET /api/taste/canon/1": () => ({ body: v1 }) });
    renderSignedIn(<Taste />);
    await open(CANON);
    await userEvent.click((await screen.findAllByRole("button", { name: "Read" }))[1]!);
    expect(await screen.findByText("One clever object.")).toBeInTheDocument();
  });

  it("gives a member no way to edit the canon", async () => {
    stubApi({ "GET /api/taste": () => ({ body: page() }) });
    renderSignedIn(<Taste />, MEMBER);
    await open(CANON);
    expect(await screen.findByText("One clever object.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("saves the rules of another scope under that scope, and leaves the owner's taste alone", async () => {
    let sent: unknown;
    stubApi({
      "GET /api/taste": () => ({ body: page({ canons: [craft] }) }),
      "POST /api/taste/canon": (body) => {
        sent = body;
        return { body: { ...v1, scope: { kind: "craft" } } };
      },
    });
    renderSignedIn(<Taste />);
    await open(OTHER);
    await userEvent.click(await screen.findByRole("button", { name: "Write Creative craft" }));
    await userEvent.type(screen.getByLabelText("All the rules"), "One light source.");
    await userEvent.type(screen.getByLabelText("What changed, and why"), "Seen in checks.");
    await userEvent.click(screen.getByRole("button", { name: "Save as version 1" }));
    await waitFor(() => expect(sent).toEqual({ text: "One light source.", reason: "Seen in checks.", scope: { kind: "craft" } }));
  });

  it("brings an earlier version back with a reason", async () => {
    const v2 = { ...v1, version: 2, text: "Newer.", reason: "Changed." };
    let sent: unknown;
    stubApi({
      "GET /api/taste": () => ({ body: page({ canon: v2, versions: [v2, v1] }) }),
      "GET /api/taste/canon/1": () => ({ body: v1 }),
      "POST /api/taste/canon/restore": (body) => {
        sent = body;
        return { body: { ...v1, version: 3 } };
      },
    });
    renderSignedIn(<Taste />);
    await open(CANON);
    await userEvent.click((await screen.findAllByRole("button", { name: "Read" }))[1]!);
    await userEvent.type(await screen.findByLabelText("Why bring version 1 back"), "The first was right.");
    await userEvent.click(screen.getByRole("button", { name: "Bring it back as version 3" }));
    await waitFor(() => expect(sent).toEqual({ version: 1, reason: "The first was right." }));
  });

  it("shows a change that waits beside the canon as it is, and sends the owner's yes in his words", async () => {
    let sent: unknown;
    let decided = false;
    const calls = stubApi({
      "GET /api/taste": () => ({ body: page({ canons: [craft], proposals: [proposal(decided ? { status: "approved", ownerSaid: "yes, no props", version: 1 } : {})] }) }),
      "POST /api/taste/proposals/pr1": (body) => {
        sent = body;
        decided = true;
        return { body: { proposal: proposal({ status: "approved" }) } };
      },
    });
    renderSignedIn(<Taste />);
    const waiting = (await screen.findByRole("heading", { name: /Waiting for your yes/ })).closest("section")!;
    // What waits is the first thing under the header, before every rule and log.
    expect(screen.getByText("1 change to a rule waits for your yes or no. Nothing in it is in use until then.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("Waiting for your yes");
    expect(within(waiting).getByText("No prop beside the food.")).toBeInTheDocument();
    expect(within(waiting).getByText("He passed on every prop.")).toBeInTheDocument();
    expect(within(waiting).getByText("Rests on 2 notes")).toBeInTheDocument();
    expect(within(waiting).getByText("Now: nothing written")).toBeInTheDocument();
    // A no needs his words too.
    expect(within(waiting).getByRole("button", { name: "No" })).toBeDisabled();

    await userEvent.type(within(waiting).getByLabelText("In your own words, for Creative craft"), "yes, no props");
    await userEvent.click(within(waiting).getByRole("button", { name: "Yes, use it" }));
    await waitFor(() => expect(sent).toEqual({ approve: true, ownerSaid: "yes, no props" }));
    expect(calls).toContain("POST /api/taste/proposals/pr1");
    await open(/^Changes you decided/);
    expect(await screen.findByText("You said yes")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Waiting for your yes/ })).not.toBeInTheDocument();
  });

  it("sends a no, and shows the studio's words when a decision is refused", async () => {
    let sent: unknown;
    stubApi({
      "GET /api/taste": () => ({ body: page({ proposals: [proposal()] }) }),
      "POST /api/taste/proposals/pr1": (body) => {
        sent = body;
        return { status: 400, body: { error: "refused", message: "Proposal pr1 is already declined." } };
      },
    });
    renderSignedIn(<Taste />);
    await userEvent.type(await screen.findByLabelText("In your own words, for Creative craft"), "not this one");
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(sent).toEqual({ approve: false, ownerSaid: "not this one" }));
    expect(await screen.findByText("Proposal pr1 is already declined.")).toBeInTheDocument();
  });

  it("takes no yes for a change written against an older version", async () => {
    stubApi({ "GET /api/taste": () => ({ body: page({ proposals: [proposal({ current: { ...v1, version: 2 }, baseVersion: 1 })] }) }) });
    renderSignedIn(<Taste />);
    expect(await screen.findByText(/written against version 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, use it" })).toBeDisabled();
  });

  it("shows a member what waits and what the studio noticed, with no way to decide", async () => {
    stubApi({
      "GET /api/taste": () => ({
        body: page({
          canons: [craft],
          proposals: [proposal()],
          learning: [
            {
              id: "r1",
              observation: "He passed on the spoon.",
              source: "The owner's words on the board.",
              scope: { kind: "craft" },
              scopeName: "Creative craft",
              lesson: "The food is the picture.",
              evidence: 2,
              confidence: "medium",
              examples: [],
              counterexamples: ["Idea 4 kept its fork."],
              expectedEffect: "Fewer passes.",
              savedBy: "agent@example.com",
              savedAt: "2026-11-22T09:00:00.000Z",
            },
          ],
        }),
      }),
    });
    renderSignedIn(<Taste />, MEMBER);
    await open(/^What the studio noticed/);
    await open(OTHER);
    expect(screen.getByRole("heading", { name: /Waiting for the owner's yes/ })).toBeInTheDocument();
    expect(screen.getByText("1 change to a rule waits for the owner's yes or no. Nothing in it is in use until then.")).toBeInTheDocument();
    expect(await screen.findByText("The food is the picture.")).toBeInTheDocument();
    expect(screen.getByText(/Seen 2 times · Fairly sure/)).toBeInTheDocument();
    expect(screen.getByText("Against it: Idea 4 kept its fork.")).toBeInTheDocument();
    expect(screen.getByText("No prop beside the food.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, use it" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Write Creative craft" })).not.toBeInTheDocument();
  });
});
