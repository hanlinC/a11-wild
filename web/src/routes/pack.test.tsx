import type { PackView } from "@a11-wild/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { stubApi } from "@/test-helpers";
import { typeOf } from "./pack";

const TOKEN = "t".repeat(43);
const text = { primary: "The skin is the best part. Order yours today.", headline: "The skin, done right", description: "Order the fish skin", cta: "Order Now" as const };
const view: PackView = {
  brand: "Wongi",
  product: "Salted egg fish skin",
  version: 2,
  at: "2026-11-21T12:00:00.000Z",
  launchPlan: ["Run all three for 72 hours.", "Keep the one with the best CTR."],
  ads: [
    {
      adName: "a11_W47_wongi_b01_tof_c1_v2",
      stage: "tof",
      viewUrl: "https://pictures.example/final-1.png?signed=1",
      words: { headline: "THE SKIN IS | THE BEST PART.", subline: "Fried until it curls." },
      meta: { version: 1, variants: [text, { ...text, headline: "Skin first" }] },
      why: "Buyers come back for the skin.",
      claims: [{ claim: "Made with real salted egg", quote: "real salted egg yolk", url: "https://wongi.example/fish-skin" }],
    },
  ],
};

const open = () =>
  render(
    <MemoryRouter initialEntries={[`/c/${TOKEN}`]}>
      <App />
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("A client's pack page", () => {
  it("opens with no sign-in and shows the ad, its text for Meta, why, the fact check and the plan", async () => {
    const calls = stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: view }) });
    open();
    expect(await screen.findByRole("heading", { name: "Wongi" })).toBeInTheDocument();
    expect(screen.getByText(/1 ad for Salted egg fish skin\. Version 2/)).toBeInTheDocument();
    expect(screen.getByText("a11_W47_wongi_b01_tof_c1_v2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The ad a11_W47_wongi_b01_tof_c1_v2" })).toHaveAttribute("src", view.ads[0]?.viewUrl);
    expect(screen.getAllByText(text.primary)).toHaveLength(2);
    expect(screen.getByText("Skin first")).toBeInTheDocument();
    expect(screen.getByText("Buyers come back for the skin.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "source" })).toHaveAttribute("href", "https://wongi.example/fish-skin");
    expect(screen.getByText("Keep the one with the best CTR.")).toBeInTheDocument();
    // The page asks for the pack only: it never asks who is signed in.
    expect(calls).toEqual([`GET /api/pack/${TOKEN}`]);
  });

  it("says plainly that a wrong link opens nothing, and shows no sign-in", async () => {
    stubApi({});
    open();
    expect(await screen.findByText(/This link does not open a pack/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("copies a line exactly as it is written", async () => {
    stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: view }) });
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    open();
    await user.click((await screen.findAllByRole("button", { name: "Copy the primary text" }))[0] as HTMLElement);
    expect(writeText).toHaveBeenCalledWith(text.primary);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("sends a results file to the link the studio signed, with the type its ending names", async () => {
    const put = "https://pictures.example/quarantine/packs/b/u.csv?put=1";
    const sent: { url: string; method?: string; type?: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, method: init?.method, type: new Headers(init?.headers).get("content-type") });
      if (url === put) return new Response(null, { status: 200 });
      if (init?.method === "POST") return Response.json({ upload: { id: "u", name: "week-1.csv" }, putUrl: put });
      return Response.json(view);
    });
    const user = userEvent.setup();
    open();
    // Windows gives a CSV the type of an Excel file: the ending decides.
    await user.upload(await screen.findByLabelText("Choose results files"), new File(["ad,ctr"], "week-1.csv", { type: "application/vnd.ms-excel" }));
    expect(await screen.findByText("week-1.csv: sent, thank you")).toBeInTheDocument();
    expect(sent.slice(1)).toEqual([
      { url: `/api/pack/${TOKEN}/uploads`, method: "POST", type: "application/json" },
      { url: put, method: "PUT", type: "text/csv" },
    ]);
  });

  it("refuses a file of another kind before it sends anything", async () => {
    const calls = stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: view }) });
    const user = userEvent.setup({ applyAccept: false });
    open();
    await user.upload(await screen.findByLabelText("Choose results files"), new File(["x"], "report.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/report\.pdf: Send a JPEG or PNG screenshot/)).toBeInTheDocument();
    await waitFor(() => expect(calls).toHaveLength(1));
  });
});

describe("typeOf", () => {
  it("names the type by the ending, in any case", () => {
    expect(typeOf("Shot.JPG")).toBe("image/jpeg");
    expect(typeOf("export.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(typeOf("page.html")).toBeUndefined();
    expect(typeOf("no-ending")).toBeUndefined();
  });
});
