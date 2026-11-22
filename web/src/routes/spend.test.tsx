import { screen, within } from "@testing-library/react";
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

    const batch = within(screen.getByRole("heading", { name: /^Batch b1/ }).closest("section")!);
    expect(batch.getAllByRole("row")).toHaveLength(3);
    expect(batch.getByText("US$1.25")).toBeInTheDocument();
    expect(batch.getByText("US$0.001")).toBeInTheDocument();
    const campaign = within(screen.getByRole("heading", { name: "Outreach campaign" }).closest("section")!);
    expect(campaign.getByText("US$0.42")).toBeInTheDocument();
    expect(campaign.getByText("US$73.60")).toBeInTheDocument();
    expect(campaign.getByText("US$1.50")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Outreach batch o1/ })).toBeInTheDocument();
    const outside = within(screen.getByRole("heading", { name: /Outside a batch/ }).closest("section")!);
    expect(outside.getByText("Not charged")).toBeInTheDocument();
  });

  it("says when nothing was spent", async () => {
    stubApi({ "GET /api/spend": () => ({ body: { month: "2026-11", monthUsd: 0, monthCapUsd: 25, batchCapUsd: 5, campaign: { usd: 0, capUsd: 73.6, batchCapUsd: 1.5 }, lines: [] } }) });
    renderSignedIn(<Spend />);
    expect(await screen.findByText("Nothing spent this month.")).toBeInTheDocument();
    expect(screen.getAllByText("US$0.00")).toHaveLength(2);
  });
});
