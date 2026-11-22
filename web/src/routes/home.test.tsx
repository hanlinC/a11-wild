import type { Attention, BatchLine } from "@a11-wild/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AttentionProvider } from "@/lib/attention";
import { MEMBER, OWNER, renderSignedIn } from "@/test-helpers";
import { Home } from "./home";

const at = "2026-11-22T03:00:00.000Z";
const line = (id: string, extra: Partial<Omit<BatchLine, "batch">> & { batch?: Partial<BatchLine["batch"]> } = {}): BatchLine => ({
  brand: { id: "br1", name: "WonGi" },
  product: { id: "p1", name: "Seaweed crisps" },
  who: "agent",
  text: "The agent makes the drafts.",
  to: `/batches/${id}`,
  ...extra,
  batch: { id, kind: "v1", state: "drafting", createdAt: at, label: id, ...extra.batch },
});
const NONE = { studio: 0, outreach: 0, clients: 0, taste: 0, connections: 0 };
const show = (value: Partial<Attention> | undefined, me = OWNER, error?: string) =>
  renderSignedIn(
    <AttentionProvider value={{ value: value && { batches: [], lines: [], counts: NONE, ...value }, error }}>
      <Home />
    </AttentionProvider>,
    me,
  );
const section = (name: RegExp) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("the start page", () => {
  it("puts what waits for the owner first, each with what is asked and the one place to do it", () => {
    show({
      batches: [
        line("pick", { who: "owner", text: "Pick one draft for each idea." }),
        line("concepts", { who: "owner", text: "Pick three concepts.", to: "/batches/concepts/concepts" }),
        line("drafting"),
      ],
      lines: [
        { kind: "ads", count: 1, to: "/outreach" },
        { kind: "replies", count: 2, to: "/outreach" },
        { kind: "connections", count: 1, to: "/connections" },
      ],
    });

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Needs you6", "In work1"]);
    const needs = within(section(/needs you/i));
    expect(needs.getAllByRole("listitem").map((item) => item.querySelector("p")?.textContent)).toEqual([
      "Pick one draft for each idea.",
      "Pick three concepts.",
      "3 things wait in Outreach",
      "1 program waits for your approval",
    ]);
    expect(needs.getByText("2 replies to answer, 1 ad to look at. You send each message by hand.")).toBeInTheDocument();
    expect(needs.getByRole("link", { name: "Open the board" })).toHaveAttribute("href", "/batches/pick");
    expect(needs.getByRole("link", { name: "Open the concepts" })).toHaveAttribute("href", "/batches/concepts/concepts");
    expect(needs.getByRole("link", { name: "Open Outreach" })).toHaveAttribute("href", "/outreach");
    expect(needs.getByRole("link", { name: "Open Connections" })).toHaveAttribute("href", "/connections");
    expect(within(section(/in work/i)).getByRole("link", { name: "drafting" })).toHaveAttribute("href", "/batches/drafting");
  });

  it("says where the answer is given when the dashboard has no button for it", () => {
    show({ batches: [line("words", { who: "owner", chat: true, text: "Say yes or no to the words." })] });

    const needs = within(section(/needs you/i));
    expect(needs.getByText("Your agent asks you in chat.")).toBeInTheDocument();
    expect(needs.getByRole("link", { name: "See the batch" })).toHaveAttribute("href", "/batches/words");
    expect(needs.queryByRole("link", { name: /open/i })).not.toBeInTheDocument();
  });

  it("says that nothing waits, and what will, when nothing does", () => {
    show({ batches: [line("drafting")] });
    expect(screen.getByText(/nothing waits for you/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect one" })).not.toBeInTheDocument();
  });

  it("folds done, outreach and test batches away, and opens each at a click", async () => {
    show({
      batches: [
        line("done", { who: "nobody", text: "Done.", batch: { state: "done" } }),
        line("cold", { batch: { purpose: "outreach", state: "waiting_pick" }, text: "The agent chooses in your place." }),
        line("try", { batch: { test: true } }),
      ],
    });

    expect(screen.getByText(/no batch is in work/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "cold" })).not.toBeInTheDocument();
    for (const [name, link] of [["Done1", "done"], ["Outreach batches1", "cold"], ["Test batches1", "try"]] as const) {
      const fold = screen.getByRole("button", { name });
      expect(fold).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(fold);
      expect(fold).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("link", { name: link })).toBeInTheDocument();
    }
  });

  it("shows a member what is in work and nothing to act on", () => {
    show({ batches: [line("pick", { who: "owner", text: "Waits for the owner." }), line("drafting")], counts: { studio: 0 } }, MEMBER);

    expect(screen.queryByRole("heading", { name: /needs you/i })).not.toBeInTheDocument();
    expect(within(section(/in work/i)).getAllByRole("link").map((link) => link.textContent)).toEqual(["pick", "drafting"]);
    expect(screen.getByText("Waits for the owner.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open the/i })).not.toBeInTheDocument();
  });

  it("says that it is loading, and says why when the studio did not answer", () => {
    const { unmount } = show(undefined);
    expect(screen.getByText("Loading")).toBeInTheDocument();
    unmount();
    show(undefined, OWNER, "The studio did not answer.");
    expect(screen.getByText("The studio did not answer.")).toBeInTheDocument();
  });

  it("keeps the last list on the page when a later read fails, and says so", () => {
    show({ batches: [line("drafting")] }, OWNER, "The studio did not answer.");
    expect(screen.getByText("The studio did not answer.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "drafting" })).toBeInTheDocument();
  });
});
