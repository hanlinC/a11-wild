import type { PackSummary } from "@a11-wild/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderSignedIn, stubApi } from "@/test-helpers";
import { Packs } from "./packs";

const text = { primary: "The skin is the best part. Order yours today.", headline: "The skin, done right", description: "Order the fish skin", cta: "Order Now" as const };
const ad = (version: number) => ({
  ideaId: "idea-1",
  adName: `a11_W47_wongi_b01_tof_c1_v${version}`,
  stage: "tof" as const,
  imageId: `final-${version}`,
  key: `batches/b/final-${version}.png`,
  viewUrl: `https://pictures.example/final-${version}.png`,
  meta: { version: 1, variants: [text, text] as [typeof text, typeof text] },
  why: "Buyers come back for the skin.",
  claims: [],
});
const pack: PackSummary = {
  pack: { id: "batch-1", source: "batch", batchId: "batch-1", current: 2, createdAt: "2026-11-21T12:00:00.000Z", by: "owner@example.com" },
  brand: { id: "brand-1", name: "Wongi" },
  product: { id: "product-1", name: "Salted egg fish skin" },
  versions: [1, 2].map((version) => ({ version, ads: [ad(version)], launchPlan: ["Run for 72 hours."], at: "2026-11-21T12:00:00.000Z", by: "owner@example.com" })),
  uploads: [
    { id: "u1", name: "week-1.png", type: "image/png", bytes: 48_211, packVersion: 2, at: "2026-11-25T12:00:00.000Z", state: "checked", openUrl: "https://pictures.example/u1.png?signed=1" },
    { id: "u2", name: "invoice.png", type: "image/png", bytes: 900, packVersion: 2, at: "2026-11-25T12:01:00.000Z", state: "refused" },
  ],
  results: [{ id: "r1", adName: "a11_W47_wongi_b01_tof_c1_v2", packVersion: 2, from: "2026-11-23", to: "2026-11-25", impressions: 12000, clicks: 180, ctr: 0.015, baselineCtr: 0.011, context: "Sales, Singapore 25 to 44.", at: "2026-11-26T12:00:00.000Z", by: "owner@example.com" }],
};

describe("Packs page", () => {
  it("shows the version the link shows, the earlier ones, the client's files and the numbers", async () => {
    stubApi({ "GET /api/packs": () => ({ body: { packs: [pack] } }) });
    renderSignedIn(<Packs />);
    expect(await screen.findByRole("heading", { name: "Wongi · Salted egg fish skin" })).toBeInTheDocument();
    expect(screen.getByText("The link shows this")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The ad a11_W47_wongi_b01_tof_c1_v2" })).toBeInTheDocument();
    // An earlier version is folded: its row says how many there are, and a click shows them.
    expect(screen.queryByText(/Version 1,/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Earlier versions\s*1$/ }));
    expect(screen.getByText(/Version 1,/)).toHaveTextContent("a11_W47_wongi_b01_tof_c1_v1");
    expect(screen.getByRole("status")).toHaveTextContent("This page is for reading.");
    expect(screen.getByRole("link", { name: "week-1.png" })).toHaveAttribute("href", pack.uploads[0]?.openUrl);
    // A file the studio deleted has no address to open.
    expect(screen.queryByRole("link", { name: "invoice.png" })).not.toBeInTheDocument();
    expect(screen.getByText(/deleted: it was not the type it was sent as/)).toBeInTheDocument();
    expect(screen.getByText(/48 KB/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1.50%" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1.10%" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "12,000" })).toBeInTheDocument();
  });

  it("says what makes a pack when there is none", async () => {
    stubApi({ "GET /api/packs": () => ({ body: { packs: [] } }) });
    renderSignedIn(<Packs />);
    expect(await screen.findByText(/No pack yet/)).toBeInTheDocument();
  });
});
