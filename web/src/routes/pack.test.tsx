import type { PackView } from "@a11-wild/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { stubApi } from "@/test-helpers";
import { changeStatus, typeOf } from "./pack";

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
      formats: ["png"],
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
  it("opens an ad large over the page, with no new tab and no address of the link sent to the picture's host", async () => {
    stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: view }) });
    open();
    const small = await screen.findByRole("img", { name: "The ad a11_W47_wongi_b01_tof_c1_v2" });
    expect(small.closest("a")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(small);
    const dialog = screen.getByRole("dialog", { name: "Picture, large" });
    const large = dialog.querySelector("img");
    expect(large).toHaveAttribute("src", view.ads[0]?.viewUrl);
    expect(large).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(dialog).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

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

  it("is set in the reading size of a web page, not the smaller size of the dashboard", async () => {
    stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: view }) });
    open();
    expect((await screen.findByRole("heading", { name: "Wongi" })).closest(".reading")).not.toBeNull();
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
      if (url.endsWith("/done")) return Response.json({ state: "checked" });
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
      // The page tells the studio the file is sent, so the studio reads it at once.
      { url: `/api/pack/${TOKEN}/uploads/u/done`, method: "POST", type: "application/json" },
    ]);
  });

  it("says so when the studio did not keep a file", async () => {
    stubApi({
      [`GET /api/pack/${TOKEN}`]: () => ({ body: view }),
      [`POST /api/pack/${TOKEN}/uploads`]: () => ({ body: { upload: { id: "u", name: "shot.png" }, putUrl: "/put" } }),
      "PUT /put": () => ({ body: {} }),
      [`POST /api/pack/${TOKEN}/uploads/u/done`]: () => ({ body: { state: "refused" } }),
    });
    const user = userEvent.setup();
    open();
    await user.upload(await screen.findByLabelText("Choose results files"), new File(["MZ"], "shot.png", { type: "image/png" }));
    expect(await screen.findByText(/shot\.png: This file is not the picture or the CSV its name says/)).toBeInTheDocument();
  });

  it("downloads an ad through an address it asks for at the click", async () => {
    const calls = stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: view }), [`GET /api/pack/${TOKEN}/download/0?format=png`]: () => ({ body: { url: "https://pictures.example/final-1.png?download=1" } }) });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Download a11_W47_wongi_b01_tof_c1_v2 as PNG" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://pictures.example/final-1.png?download=1"));
    expect(calls).toHaveLength(2);
  });

  it("takes a comment on the pack and shows it, as text and never as markup", async () => {
    const sent: unknown[] = [];
    stubApi({
      [`GET /api/pack/${TOKEN}`]: () => ({ body: { ...view, comments: [{ text: "<b>Earlier</b> comment", at: "2026-11-22T10:00:00.000Z" }] } }),
      [`POST /api/pack/${TOKEN}/comments`]: (body) => {
        sent.push(body);
        return { body: { comment: { text: "We love these.", at: "2026-11-22T12:00:00.000Z" } } };
      },
    });
    const user = userEvent.setup();
    open();
    expect(await screen.findByText("<b>Earlier</b> comment")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Write a comment to the studio"), "We love these.");
    await user.click(screen.getByRole("button", { name: "Send the comment" }));
    expect(await screen.findByText("We love these.")).toBeInTheDocument();
    expect(sent).toEqual([{ text: "We love these." }]);
    expect(screen.getByLabelText("Write a comment to the studio")).toHaveValue("");
  });

  it("still shows a change request whose ad is no longer in the pack", async () => {
    stubApi({
      [`GET /api/pack/${TOKEN}`]: () => ({ body: { ...view, comments: [{ text: "Drop the discount line.", adName: "a11_gone_ad_v1", change: { what: "offer", status: "declined" }, at: "2026-11-21T10:00:00.000Z" }] } }),
    });
    open();
    expect(await screen.findByRole("heading", { name: "Earlier change requests" })).toBeInTheDocument();
    expect(screen.getByText("Drop the discount line.")).toBeInTheDocument();
    expect(screen.getByText("a11_gone_ad_v1")).toBeInTheDocument();
    expect(screen.getByText(changeStatus({ what: "offer", status: "declined" }))).toBeInTheDocument();
  });

  it("asks for a change to one ad and shows where the request stands", async () => {
    const sent: unknown[] = [];
    const adName = view.ads[0]!.adName;
    stubApi({
      [`GET /api/pack/${TOKEN}`]: () => ({ body: { ...view, comments: [{ text: "A warmer photo, please.", adName, change: { what: "picture", status: "done", version: 2 }, at: "2026-11-21T10:00:00.000Z" }] } }),
      [`POST /api/pack/${TOKEN}/comments`]: (body) => {
        sent.push(body);
        return { body: { comment: { text: "Make the price larger.", adName, change: { what: "offer", status: "received" }, at: "2026-11-22T12:00:00.000Z" } } };
      },
    });
    const user = userEvent.setup();
    open();
    expect(await screen.findByText("Done in version 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask for a change" }));
    await user.selectOptions(screen.getByLabelText("What should change"), "The offer or price");
    await user.type(screen.getByLabelText("The change, in one or two sentences"), "Make the price larger.");
    await user.click(screen.getByRole("button", { name: "Send the request" }));
    expect(await screen.findByText("Make the price larger.")).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(sent).toEqual([{ text: "Make the price larger.", adName, change: "offer" }]);
    // A request is not listed again among the comments on the pack.
    expect(screen.getByText("No comment yet.")).toBeInTheDocument();
  });

  it("refuses to send and says why when the studio refuses a comment", async () => {
    stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: view }), [`POST /api/pack/${TOKEN}/comments`]: () => ({ status: 400, body: { error: "refused", message: "This pack holds 50 comments, which is its fill." } }) });
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByLabelText("Write a comment to the studio"), "One more.");
    await user.click(screen.getByRole("button", { name: "Send the comment" }));
    expect(await screen.findByText("This pack holds 50 comments, which is its fill.")).toBeInTheDocument();
  });
});

describe("The example page", () => {
  const example: PackView = {
    ...view,
    example: {
      note: "Wongi is not a client of a11 studio. We used their product, as it is sold today, to show what a client receives.",
      comments: [
        { text: "These are exactly our tone." },
        { text: "Could the price be larger?", adName: view.ads[0]!.adName, change: { what: "offer", status: "done", version: 2 } },
      ],
    },
  };

  it("shows the ads first, a quiet tag and line, and example comments", async () => {
    stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: example }) });
    open();
    expect(await screen.findByRole("heading", { level: 1, name: /Wongi\s*Example/ })).toBeInTheDocument();
    // Nothing sits above the first ad except the title: the note comes after the pictures.
    const picture = screen.getByRole("img", { name: /The ad/ });
    const note = screen.getByText(/is not a client of a11 studio/);
    expect(picture.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Example comments" })).toBeInTheDocument();
    expect(screen.getByText("These are exactly our tone.")).toBeInTheDocument();
    expect(screen.getByText("Example change request")).toBeInTheDocument();
    expect(screen.getByText("Done in version 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download .* as PNG/ })).toBeInTheDocument();
  });

  it("has nothing to write in and nowhere to send a file", async () => {
    stubApi({ [`GET /api/pack/${TOKEN}`]: () => ({ body: example }) });
    open();
    await screen.findByRole("heading", { name: "Example comments" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask for a change" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Choose results files")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Send your results" })).not.toBeInTheDocument();
  });
});

describe("A client's page", () => {
  const CLIENT = "k".repeat(43);
  const openClient = () =>
    render(
      <MemoryRouter initialEntries={[`/client/${CLIENT}`]}>
        <App />
      </MemoryRouter>,
    );

  it("shows every pack, newest first, and writes to the pack the comment is on", async () => {
    const sent: unknown[] = [];
    const calls = stubApi({
      [`GET /api/client/${CLIENT}`]: () => ({ body: { brand: "Wongi", packs: [{ ...view, ref: "r".repeat(24), product: "Prawn crackers", comments: [] }, { ...view, ref: "s".repeat(24), version: 1, comments: [], ads: [{ ...view.ads[0]!, adName: "a11_W46_wongi_b01_tof_c1_v1" }] }] } }),
      [`POST /api/client/${CLIENT}/packs/${"s".repeat(24)}/comments`]: (body) => {
        sent.push(body);
        return { body: { comment: { text: "Second pack.", at: "2026-11-22T12:00:00.000Z" } } };
      },
    });
    const user = userEvent.setup();
    openClient();
    expect(await screen.findByRole("heading", { level: 1, name: "Wongi" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).slice(0, 1).map((heading) => heading.textContent)).toEqual(["Prawn crackers"]);
    const boxes = screen.getAllByLabelText("Write a comment to the studio");
    expect(boxes).toHaveLength(2);
    await user.type(boxes[1]!, "Second pack.");
    await user.click(screen.getAllByRole("button", { name: "Send the comment" })[1]!);
    expect(await screen.findByText("Second pack.")).toBeInTheDocument();
    expect(sent).toEqual([{ text: "Second pack." }]);
    // The page never asks who is signed in.
    expect(calls[0]).toBe(`GET /api/client/${CLIENT}`);
    expect(calls).toHaveLength(2);
  });

  it("is a page also before the first pack, and a wrong link opens nothing", async () => {
    stubApi({ [`GET /api/client/${CLIENT}`]: () => ({ body: { brand: "Wongi", packs: [] } }) });
    const { unmount } = openClient();
    expect(await screen.findByText("Your first pack appears here when it is ready.")).toBeInTheDocument();
    unmount();
    stubApi({});
    openClient();
    expect(await screen.findByText(/This link does not open a page/)).toBeInTheDocument();
  });
});

describe("A results file", () => {
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
    expect(typeOf("export.CSV")).toBe("text/csv");
    expect(typeOf("export.xlsx")).toBeUndefined();
    expect(typeOf("page.html")).toBeUndefined();
    expect(typeOf("no-ending")).toBeUndefined();
  });
});
