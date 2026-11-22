import type { Attention, BatchLine, BrandPage } from "@a11-wild/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AttentionProvider } from "@/lib/attention";
import { MEMBER, renderSignedIn, stubApi } from "@/test-helpers";
import { Brand } from "./brand";

const PAGE = "https://wongi.example/products/seaweed-crisps";

function brandPage(overrides: Partial<BrandPage["products"][number]> = {}): BrandPage {
  return {
    brand: { id: "b1", name: "WonGi", url: "https://wongi.example/", logo: null, palette: [{ role: "primary", hex: "#FFD419", note: "brand yellow" }], fonts: ["Babydoll"], createdAt: "2026-11-21T10:00:00.000Z", savedBy: "owner@example.com" },
    logoUrl: null,
    products: [
      {
        product: { id: "p1", brandId: "b1", name: "Seaweed crisps", url: PAGE, photos: [], createdAt: "2026-11-21T10:00:00.000Z", savedBy: "owner@example.com" },
        facts: [{ id: "f1", productId: "p1", claim: "A pack holds 40 g", quote: "Net weight: 40 g.", url: PAGE, checkedAt: "2026-11-21T10:00:00.000Z", savedBy: "owner@example.com" }],
        truthSheet: {
          productId: "p1",
          version: 2,
          shape: "A flat pouch with a zip top.",
          packaging: "Matt black pouch.",
          measures: [
            { name: "net weight", value: 40, unit: "g", status: "sourced", source: { factId: "f1", quote: "Net weight: 40 g.", url: PAGE } },
            { name: "pack height", value: 180, unit: "mm", status: "unverified" },
          ],
          savedAt: "2026-11-21T10:00:00.000Z",
          savedBy: "owner@example.com",
        },
        ...overrides,
      },
    ],
    batches: [],
    canon: { version: 0, text: "", reason: "", savedBy: "", savedAt: "" },
    canonVersions: [],
    notes: [],
  };
}

function show(page: BrandPage) {
  stubApi({ "GET /api/brands/b1": () => ({ body: page }) });
  renderSignedIn(
    <Routes>
      <Route path="brands/:brandId" element={<Brand />} />
    </Routes>,
    undefined,
    "/brands/b1",
  );
}

const line = (id: string, who: BatchLine["who"], text: string, batch: Partial<BatchLine["batch"]> = {}, brandId = "b1"): BatchLine => ({
  batch: { id, label: `W47 ${id}`, kind: "v1", state: "waiting_pick", createdAt: "2026-11-21T10:00:00.000Z", ...batch },
  brand: { id: brandId, name: "WonGi" },
  product: { id: "p1", name: "Seaweed crisps" },
  who,
  text,
  to: `/batches/${id}`,
});

function showWith(batches: BatchLine[], page = brandPage(), me?: typeof MEMBER) {
  stubApi({ "GET /api/brands/b1": () => ({ body: page }) });
  const value: Attention = { batches, lines: [], counts: { studio: 0 } };
  renderSignedIn(
    <AttentionProvider value={{ value, error: undefined }}>
      <Routes>
        <Route path="brands/:brandId" element={<Brand />} />
      </Routes>
    </AttentionProvider>,
    me,
    "/brands/b1",
  );
}

describe("Brand page", () => {
  it("leads with the batch that waits for the owner, then what is in work, before the kit", async () => {
    showWith([
      line("x1", "owner", "Pick one draft for each idea."),
      line("x2", "agent", "The agent makes the drafts."),
      line("x3", "nobody", "Done.", { state: "done" }),
      line("x4", "agent", "The agent makes the drafts.", { purpose: "outreach" }),
      line("x9", "owner", "Pick one draft for each idea.", {}, "b2"),
    ]);
    const needs = (await screen.findByRole("heading", { name: /Needs you/ })).closest("section")!;
    expect(within(needs).getByText("Pick one draft for each idea.")).toBeInTheDocument();
    expect(within(needs).getByRole("link", { name: /Open the board/ })).toHaveAttribute("href", "/batches/x1");
    expect(within(needs).queryByText(/x9/)).toBeNull();
    const work = screen.getByRole("heading", { name: /In work/ }).closest("section")!;
    expect(within(work).getByRole("link", { name: "W47 x2" })).toBeInTheDocument();
    expect(within(work).queryByRole("link", { name: "W47 x3" })).toBeNull();
    expect(needs.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(work.compareDocumentPosition(screen.getByRole("heading", { name: "Kit" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // What asks nothing is folded at the foot.
    expect(screen.queryByRole("link", { name: "W47 x3" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Done, outreach and test batches/ }));
    expect(screen.getByRole("link", { name: "W47 x3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "W47 x4" })).toBeInTheDocument();
  });

  it("asks a member nothing: a batch that waits for the owner is in work", async () => {
    showWith([line("x1", "owner", "Waits for the owner.")], brandPage(), MEMBER);
    await screen.findByRole("heading", { name: /In work/ });
    expect(screen.queryByRole("heading", { name: /Needs you/ })).toBeNull();
    expect(screen.getByRole("link", { name: "W47 x1" })).toBeInTheDocument();
  });

  it("says what starts a batch when the brand has none in work", async () => {
    showWith([]);
    expect(await screen.findByText(/No batch is in work for this brand\. Your agent starts one/)).toBeInTheDocument();
  });

  it("shows the first three facts of a long list, and the rest at a click", async () => {
    const fact = (n: number) => ({ id: `f${n}`, productId: "p1", claim: `Fact number ${n}`, quote: `Quote ${n}.`, url: PAGE, checkedAt: "2026-11-21T10:00:00.000Z", savedBy: "owner@example.com" });
    showWith([], brandPage({ facts: [1, 2, 3, 4, 5].map(fact) }));
    expect(await screen.findByText("Fact number 3")).toBeInTheDocument();
    expect(screen.queryByText("Fact number 4")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show all 5 facts" }));
    expect(screen.getByText("Fact number 5")).toBeInTheDocument();
  });

  it("lists the batches by their state when who acts next could not be read", async () => {
    const page = brandPage();
    show({ ...page, batches: [{ id: "x1", label: "W47 x1", state: "drafting", createdAt: "2026-11-21T10:00:00.000Z" } as BrandPage["batches"][number]] });
    const all = (await screen.findByRole("heading", { name: /Batches/ })).closest("section")!;
    expect(within(all).getByRole("link", { name: "W47 x1" })).toHaveAttribute("href", "/batches/x1");
    expect(within(all).getByText("drafting")).toBeInTheDocument();
  });

  it("shows each fact with its quote and a link that opens in a new tab without the opener", async () => {
    show(brandPage());
    expect(await screen.findByText("A pack holds 40 g")).toBeInTheDocument();
    const fact = screen.getByText("A pack holds 40 g").closest("li")!;
    expect(within(fact).getByText("“Net weight: 40 g.”")).toBeInTheDocument();
    const link = within(fact).getByRole("link", { name: PAGE });
    expect(link).toHaveAttribute("href", PAGE);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the word unverified beside a number with no source, and the source beside one that has it", async () => {
    show(brandPage());
    const height = (await screen.findByText("pack height")).closest("li")!;
    expect(within(height).getByText("unverified")).toBeInTheDocument();
    const weight = screen.getByText("net weight").closest("li")!;
    expect(within(weight).queryByText("unverified")).not.toBeInTheDocument();
    expect(within(weight).getByRole("link", { name: "source" })).toHaveAttribute("href", PAGE);
  });

  it("shows the version of the truth sheet", async () => {
    show(brandPage());
    expect(await screen.findByText("Version 2")).toBeInTheDocument();
  });

  it("says plainly when a product has no fact and no truth sheet yet", async () => {
    show(brandPage({ facts: [], truthSheet: null }));
    expect(await screen.findByText(/No fact yet/)).toBeInTheDocument();
    expect(screen.getByText(/Not written yet/)).toBeInTheDocument();
  });

  it("says so when the brand is not there", async () => {
    stubApi({});
    renderSignedIn(
      <Routes>
        <Route path="brands/:brandId" element={<Brand />} />
      </Routes>,
      undefined,
      "/brands/gone",
    );
    expect(await screen.findByText("That is no longer there.")).toBeInTheDocument();
  });

  const note = { id: "n1", brandId: "b1", note: "Show the pouch, not the bowl.", ownerSaid: "pouch pls", batchId: "batch-1", savedBy: "owner@example.com", at: "2026-11-22T10:00:00.000Z" };
  const element = (
    <Routes>
      <Route path="brands/:brandId" element={<Brand />} />
    </Routes>
  );

  it("keeps a choice the owner types for this brand, and shows it with the words he said", async () => {
    let sent: unknown;
    stubApi({
      "GET /api/brands/b1": () => ({ body: { ...brandPage(), notes: sent ? [note] : [] } }),
      "POST /api/brands/b1/notes": (body) => {
        sent = body;
        return { body: note };
      },
    });
    renderSignedIn(element, undefined, "/brands/b1");
    expect(await screen.findByText("Nothing yet for this brand.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("A choice for this brand"), "Show the pouch, not the bowl.");
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(sent).toEqual({ note: "Show the pouch, not the bowl." }));
    expect(await screen.findByText("Show the pouch, not the bowl.")).toBeInTheDocument();
    expect(screen.getByText("You said: pouch pls")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "the batch it came from" })).toHaveAttribute("href", "/batches/batch-1");
    expect(screen.getByLabelText("A choice for this brand")).toHaveValue("");
  });

  it("saves this brand's rules under this brand", async () => {
    let sent: unknown;
    stubApi({
      "GET /api/brands/b1": () => ({ body: brandPage() }),
      "POST /api/taste/canon": (body) => {
        sent = body;
        return { body: {} };
      },
    });
    renderSignedIn(element, undefined, "/brands/b1");
    await userEvent.click(await screen.findByRole("button", { name: "Write the rules" }));
    await userEvent.type(screen.getByLabelText("All the rules"), "Show the cap.");
    await userEvent.type(screen.getByLabelText("What changed, and why"), "He said so.");
    await userEvent.click(screen.getByRole("button", { name: "Save as version 1" }));
    await waitFor(() => expect(sent).toEqual({ text: "Show the cap.", reason: "He said so.", scope: { kind: "brand", brandId: "b1" } }));
  });

  it("shows a member the choices and the rules, with no way to change them", async () => {
    stubApi({ "GET /api/brands/b1": () => ({ body: { ...brandPage(), notes: [note], canon: { version: 1, text: "Show the cap.", reason: "He said so.", savedBy: "owner@example.com", savedAt: "2026-11-22T10:00:00.000Z" } } }) });
    renderSignedIn(element, MEMBER, "/brands/b1");
    expect(await screen.findByText("Show the pouch, not the bowl.")).toBeInTheDocument();
    expect(screen.getByText("Show the cap.")).toBeInTheDocument();
    expect(screen.queryByLabelText("A choice for this brand")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
