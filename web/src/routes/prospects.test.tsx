import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { prospectRow } from "@/outreach-fixtures";
import { renderSignedIn, stubApi } from "@/test-helpers";
import { Prospects } from "./prospects";

const count = (all: number, tiers: [number, number, number], channels: [number, number]) => ({ all, byTier: { "20+": tiers[0], "5-19": tiers[1], "<5": tiers[2] }, byChannel: { whatsapp: channels[0], email: channels[1] } });
const page = (rows = [prospectRow(), prospectRow({ id: "00002", n: 2, brand: "Glow Lab", sector: "Beauty", stage: "contacted", next: { step: 1, due: "2026-11-26" }, sameContactAs: "Koi Tea" })]) => ({
  numbers: { prospects: 857, sent: count(12, [7, 4, 1], [9, 3]), replied: count(3, [2, 1, 0], [2, 1]), saidMore: count(1, [1, 0, 0], [1, 0]), optedOut: count(2, [0, 2, 0], [2, 0]), clients: count(0, [0, 0, 0], [0, 0]) },
  sectors: ["Beauty", "F&B"],
  rows,
});

describe("Prospects page", () => {
  it("shows the numbers by tier and by channel, and each brand without a number or an address", async () => {
    stubApi({ "GET /api/outreach/prospects": () => ({ body: page() }) });
    renderSignedIn(<Prospects />);
    const sent = within((await screen.findByRole("rowheader", { name: "Sent" })).closest("tr")!);
    expect(sent.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["12", "7", "4", "1", "9", "3"]);
    expect(screen.getByRole("link", { name: "Koi Tea" })).toHaveAttribute("href", "/outreach/prospects/00001");
    expect(screen.getByText(/Follow-up 1 is due Thu, 26 Nov 2026\. Same contact as Koi Tea\./)).toBeInTheDocument();
  });

  it("sends the search and each filter to the server", async () => {
    const calls = stubApi({
      "GET /api/outreach/prospects": () => ({ body: page() }),
      "GET /api/outreach/prospects?stage=lost": () => ({ body: page([]) }),
      "GET /api/outreach/prospects?stage=lost&sector=Beauty": () => ({ body: page([]) }),
    });
    renderSignedIn(<Prospects />);
    await userEvent.selectOptions(await screen.findByLabelText("Stage"), "Lost");
    expect(await screen.findByText("No brand fits the search and the filters.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Sector"), "Beauty");
    await waitFor(() => expect(calls).toContain("GET /api/outreach/prospects?stage=lost&sector=Beauty"));
  });

  it("makes a test prospect with the contact he gives", async () => {
    let sent: unknown;
    stubApi({ "GET /api/outreach/prospects": () => ({ body: page() }), "POST /api/outreach/test-prospect": (body) => ((sent = body), { body: { id: "T1" } }) });
    renderSignedIn(<Prospects />);
    await userEvent.type(await screen.findByLabelText(/Or your own address/), "me@test.example");
    await userEvent.click(screen.getByRole("button", { name: "Make a test prospect" }));
    await waitFor(() => expect(sent).toEqual({ email: "me@test.example" }));
  });
});
