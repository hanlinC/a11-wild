import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderSignedIn, stubApi } from "@/test-helpers";
import { Spend } from "./spend";

const line = (overrides: object) => ({ at: "2026-11-21T10:00:00.000Z", service: "parallel", kind: "extract", ref: "https://wongi.example/", usd: 0.001, status: "spent", ...overrides });

describe("Spend page", () => {
  it("shows the month's total, both caps and each batch's lines", async () => {
    stubApi({
      "GET /api/spend": () => ({
        body: {
          month: "2026-11",
          monthUsd: 1.26,
          monthCapUsd: 25,
          batchCapUsd: 5,
          campaign: { usd: 0.42, capUsd: 73.6, batchCapUsd: 1.5 },
          lines: [
            line({ batchId: "b1", usd: 1.25, service: "fal", kind: "draft", ref: "idea-1" }),
            line({ batchId: "b1" }),
            line({ batchId: "o1", usd: 0.42, service: "fal", kind: "draft", ref: "idea-2", campaign: true }),
            line({ status: "released", ref: "https://gone.example/" }),
          ],
        },
      }),
    });
    renderSignedIn(<Spend />);

    expect(await screen.findByText("US$1.26")).toBeInTheDocument();
    expect(screen.getByText("US$25.00")).toBeInTheDocument();
    expect(screen.getByText("US$5.00")).toBeInTheDocument();

    // The log is folded: one row for each batch with what was paid, and no call until a row is opened.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const row = screen.getByRole("button", { name: /^Batch b1/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row).toHaveTextContent("2 calls");
    expect(row).toHaveTextContent("US$1.25");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const batch = within(screen.getByRole("table", { name: "Calls of Batch b1" }));
    expect(batch.getAllByRole("row")).toHaveLength(3);
    expect(batch.getByText("US$1.25")).toBeInTheDocument();
    expect(batch.getByText("US$0.001")).toBeInTheDocument();
    await userEvent.click(row);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const campaign = within(screen.getByRole("heading", { name: "Outreach campaign" }).closest("section")!);
    expect(campaign.getByText("US$0.42")).toBeInTheDocument();
    expect(campaign.getByText("US$73.60")).toBeInTheDocument();
    expect(campaign.getByText("US$1.50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Outreach batch o1/ })).toHaveTextContent("US$0.42");
    // A call that was not charged is in no total.
    const outside = screen.getByRole("button", { name: /^Outside a batch/ });
    expect(outside).toHaveTextContent("US$0.00");
    await userEvent.click(outside);
    expect(within(screen.getByRole("table", { name: "Calls of Outside a batch" })).getByText("Not charged")).toBeInTheDocument();
  });

  it("puts the batch with the newest call first, says what is still held, and keeps the older batches behind one button", async () => {
    const lines = Array.from({ length: 10 }, (_, n) => line({ batchId: `batch-${n}`, at: `2026-11-${String(10 + n).padStart(2, "0")}T10:00:00.000Z` }));
    lines.push(line({ batchId: "batch-9", at: "2026-11-19T11:00:00.000Z", status: "reserved", usd: 0.5 }));
    stubApi({ "GET /api/spend": () => ({ body: { month: "2026-11", monthUsd: 0.01, monthCapUsd: 25, batchCapUsd: 5, campaign: { usd: 0, capUsd: 73.6, batchCapUsd: 1.5 }, lines } }) });
    renderSignedIn(<Spend />);
    const rows = () => screen.getAllByRole("button", { name: /^Batch / });
    expect(await screen.findByRole("button", { name: /^Batch batch-9/ })).toHaveTextContent("US$0.50 held");
    expect(rows().map((row) => row.textContent?.match(/batch-\d/)?.[0])).toEqual(["batch-9", "batch-8", "batch-7", "batch-6", "batch-5", "batch-4", "batch-3", "batch-2"]);
    await userEvent.click(screen.getByRole("button", { name: "Show 2 older" }));
    expect(rows()).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "Show the newest only" }));
    expect(rows()).toHaveLength(8);
  });

  it("says when nothing was spent", async () => {
    stubApi({ "GET /api/spend": () => ({ body: { month: "2026-11", monthUsd: 0, monthCapUsd: 25, batchCapUsd: 5, campaign: { usd: 0, capUsd: 73.6, batchCapUsd: 1.5 }, lines: [] } }) });
    renderSignedIn(<Spend />);
    expect(await screen.findByText("Nothing spent this month.")).toBeInTheDocument();
    expect(screen.getAllByText("US$0.00")).toHaveLength(2);
  });
});
