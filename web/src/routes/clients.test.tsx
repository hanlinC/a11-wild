import type { OwnerClient } from "@a11-wild/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSignedIn, stubApi } from "@/test-helpers";
import { Clients } from "./clients";

const AD = "a11_W47_wongi_b01_tof_c1_v2";
const clients: OwnerClient[] = [
  {
    brand: { id: "brand-1", name: "Wongi" },
    link: { brandId: "brand-1", state: "on", at: "2026-11-22T10:00:00.000Z", by: "owner@example.com" },
    packs: [
      {
        packId: "pack-1",
        product: "Salted egg fish skin",
        version: 2,
        at: "2026-11-22T10:00:00.000Z",
        example: false,
        ads: [{ adName: AD, viewUrl: "https://pictures.example/final-1.png?signed=1" }],
        comments: [
          { id: "c1", text: "We love <b>these</b>.", at: "2026-11-22T11:00:00.000Z" },
          { id: "c2", text: "Make the price larger.", adName: AD, change: { what: "offer", status: "received" }, at: "2026-11-22T12:00:00.000Z" },
          { id: "c3", text: "A warmer photo.", adName: AD, change: { what: "picture", status: "done", version: 2 }, at: "2026-11-21T12:00:00.000Z" },
        ],
        uploads: [
          { id: "u1", name: "week-1.png", type: "image/png", bytes: 4000, packVersion: 2, at: "2026-11-25T12:00:00.000Z", state: "checked", openUrl: "https://pictures.example/u1.png?signed=1" },
          { id: "u2", name: "week-1.csv", type: "text/csv", bytes: 300, packVersion: 2, at: "2026-11-25T12:01:00.000Z", state: "checked" },
          { id: "u3", name: "invoice.png", type: "image/png", bytes: 900, packVersion: 2, at: "2026-11-25T12:02:00.000Z", state: "refused" },
        ],
      },
    ],
  },
  { brand: { id: "brand-2", name: "Zest" }, packs: [] },
];

afterEach(() => vi.unstubAllGlobals());

describe("The owner's Clients page", () => {
  it("puts the change requests that wait first, and sets a status with one click", async () => {
    const sent: unknown[] = [];
    stubApi({
      "GET /api/portal": () => ({ body: { clients } }),
      "POST /api/packs/pack-1/comments/c2": (body) => {
        sent.push(body);
        return { body: { comment: { ...clients[0]!.packs[0]!.comments[1], change: { what: "offer", status: "in_work" } } } };
      },
    });
    const user = userEvent.setup();
    renderSignedIn(<Clients />);
    const waiting = (await screen.findByRole("heading", { name: /Change requests that wait/ })).closest("section") as HTMLElement;
    // Only the open request waits: the one that is done does not.
    expect(within(waiting).getByText("Make the price larger.")).toBeInTheDocument();
    expect(within(waiting).queryByText("A warmer photo.")).not.toBeInTheDocument();
    expect(within(waiting).getByRole("img", { name: `The ad ${AD}` })).toBeInTheDocument();
    await user.click(within(waiting).getByRole("button", { name: /Set to In work: Make the price larger/ }));
    expect(sent).toEqual([{ status: "in_work" }]);
    expect(await within(waiting).findByText(/· In work/)).toBeInTheDocument();
    // A client's words are text on the page, never markup.
    expect(screen.getByText("We love <b>these</b>.")).toBeInTheDocument();
  });

  it("hides a comment from the client's page", async () => {
    const sent: unknown[] = [];
    stubApi({
      "GET /api/portal": () => ({ body: { clients } }),
      "POST /api/packs/pack-1/comments/c1": (body) => {
        sent.push(body);
        return { body: { comment: { ...clients[0]!.packs[0]!.comments[0], hidden: true } } };
      },
    });
    const user = userEvent.setup();
    renderSignedIn(<Clients />);
    await user.click(await screen.findByRole("button", { name: /Hide: We love/ }));
    expect(sent).toEqual([{ hidden: true }]);
    expect(await screen.findByText(/hidden from the client's page/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show: We love/ })).toBeInTheDocument();
  });

  it("opens a checked picture, shows a CSV as a table of text, and gives no way to open a deleted file", async () => {
    stubApi({
      "GET /api/portal": () => ({ body: { clients } }),
      "GET /api/packs/pack-1/uploads/u2/table": () => ({ body: { rows: [["Ad name", "Clicks"], ['=HYPERLINK("https://evil.example")', "180"]], cut: true } }),
    });
    const user = userEvent.setup();
    renderSignedIn(<Clients />);
    expect(await screen.findByRole("link", { name: "week-1.png" })).toHaveAttribute("href", "https://pictures.example/u1.png?signed=1");
    expect(screen.queryByRole("link", { name: "week-1.csv" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "invoice.png" })).not.toBeInTheDocument();
    expect(screen.getByText(/deleted: it was not the type it was sent as/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show week-1.csv as a table" }));
    const table = await screen.findByRole("table", { name: "The file week-1.csv" });
    expect(within(table).getByRole("cell", { name: '=HYPERLINK("https://evil.example")' })).toBeInTheDocument();
    expect(within(table).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("The file is longer than this table shows.")).toBeInTheDocument();
  });

  it("makes, replaces and turns off a client's link, and shows a new link once", async () => {
    const sent: unknown[] = [];
    stubApi({
      "GET /api/portal": () => ({ body: { clients } }),
      "POST /api/portal/brand-2/link": (body) => {
        sent.push(body);
        return { body: { url: "https://studio.example.com/client/new-link" } };
      },
      "POST /api/portal/brand-1/link": (body) => {
        sent.push(body);
        return { body: { link: { brandId: "brand-1", state: "off" } } };
      },
    });
    const user = userEvent.setup();
    renderSignedIn(<Clients />);
    expect(await screen.findByText("This brand has no client link yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Make the link" }));
    expect(await screen.findByText("https://studio.example.com/client/new-link")).toBeInTheDocument();
    expect(screen.getByText(/It is not shown again/)).toBeInTheDocument();
    // Both brands have a link now. The first is Wongi's.
    await user.click(screen.getAllByRole("button", { name: "Turn the link off" })[0]!);
    await waitFor(() => expect(screen.getByText(/turned off: it opens nothing/)).toBeInTheDocument());
    expect(sent).toEqual([{ action: "make" }, { action: "off" }]);
  });

  it("makes a new link for a brand whose link was turned off, where the studio refuses to replace", async () => {
    const sent: unknown[] = [];
    stubApi({
      "GET /api/portal": () => ({ body: { clients: clients.map((client) => (client.brand.id === "brand-1" ? { ...client, link: { ...client.link, state: "off" } } : client)) } }),
      "POST /api/portal/brand-1/link": (body) => {
        sent.push(body);
        return { body: { url: "https://studio.example.com/client/again" } };
      },
    });
    const user = userEvent.setup();
    renderSignedIn(<Clients />);
    await user.click(await screen.findByRole("button", { name: "Make a new link" }));
    expect(await screen.findByText("https://studio.example.com/client/again")).toBeInTheDocument();
    expect(sent).toEqual([{ action: "make" }]);
  });

  it("says so when nothing waits and no brand has a pack", async () => {
    stubApi({ "GET /api/portal": () => ({ body: { clients: [] } }) });
    renderSignedIn(<Clients />);
    expect(await screen.findByText("No change request waits for you.")).toBeInTheDocument();
    expect(screen.getByText("A brand appears here when it has a pack or a client link.")).toBeInTheDocument();
  });
});
