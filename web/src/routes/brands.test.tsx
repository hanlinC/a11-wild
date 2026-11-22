import type { Attention, BatchLine, BrandKit } from "@a11-wild/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttentionProvider } from "@/lib/attention";
import { MEMBER, renderSignedIn, stubApi } from "@/test-helpers";
import { Brands } from "./brands";

const at = "2026-11-21T10:00:00.000Z";
const kit = (id: string, name: string): BrandKit => ({ id, name, url: `https://${id}.example/`, logo: null, palette: [], fonts: [], createdAt: at, savedBy: "owner@example.com" });
const line = (id: string, brandId: string, who: BatchLine["who"], batch: Partial<BatchLine["batch"]> = {}): BatchLine => ({
  batch: { id, kind: "v1", state: "waiting_pick", createdAt: at, ...batch },
  brand: { id: brandId, name: brandId },
  product: { id: "p1", name: "Seaweed crisps" },
  who,
  text: "Pick one draft for each idea.",
  to: `/batches/${id}`,
});

function show(batches: BatchLine[], me?: typeof MEMBER) {
  stubApi({
    "GET /api/brands": () => ({
      body: {
        brands: [
          { brand: kit("b1", "WonGi"), logoUrl: null, products: [{ id: "p1", name: "Seaweed crisps" }] },
          { brand: kit("b2", "Calm Tea"), logoUrl: null, products: [] },
        ],
      },
    }),
  });
  const value: Attention = { batches, lines: [], counts: { studio: 0 } };
  renderSignedIn(
    <AttentionProvider value={{ value, error: undefined }}>
      <Brands />
    </AttentionProvider>,
    me,
  );
}
const card = async (name: string) => (await screen.findByText(name)).closest("li")!;

describe("Brands page", () => {
  it("marks the brand whose batch waits for the owner, and says how many are in work", async () => {
    show([line("x1", "b1", "owner"), line("x2", "b1", "agent"), line("x3", "b1", "agent"), line("x4", "b1", "nobody", { state: "done" })]);
    const first = await card("WonGi");
    expect(within(first).getByText("1 batch waits for you · 2 in work")).toBeInTheDocument();
    expect(within(first).getByText("waiting for you", { exact: false })).toBeInTheDocument();
    expect(within(await card("Calm Tea")).queryByText(/in work|for you/)).toBeNull();
  });

  it("counts no test batch and no outreach batch", async () => {
    show([line("x1", "b1", "agent", { test: true }), line("x2", "b1", "agent", { purpose: "outreach" })]);
    expect(within(await card("WonGi")).queryByText(/in work|for you/)).toBeNull();
  });

  it("asks nothing of a member: a batch that waits for the owner is in work", async () => {
    show([line("x1", "b1", "owner")], MEMBER);
    const first = await card("WonGi");
    expect(within(first).getByText("1 in work")).toBeInTheDocument();
    expect(within(first).queryByText(/for you/)).toBeNull();
  });
});
