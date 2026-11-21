import type { BrandPage } from "@a11-wild/shared";
import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { renderSignedIn, stubApi } from "@/test-helpers";
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

describe("Brand page", () => {
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
});
