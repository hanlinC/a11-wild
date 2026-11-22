import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MEMBER, OWNER, renderSignedIn, stubApi, windowIs } from "@/test-helpers";
import { Shell } from "./shell";

const counts = (counts: object) => stubApi({ "GET /api/attention": () => ({ body: { batches: [], lines: [], counts } }) });
/** A name with a count in it. The count is its own element, so the white space around it is not fixed. */
const waits = (name: string) => new RegExp(`^${name.replace(/, (\d)/g, "\\s*,\\s*$1").replace(/(\d) waiting/, "$1\\s*waiting")}$`);
const phone = () => windowIs("phone");

describe("Shell", () => {
  it("keeps the sections of every day in the bar and the others behind More", async () => {
    renderSignedIn(<Shell />, OWNER);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Studio", "Brands", "Outreach", "Packs", "Clients"]);
    const more = screen.getByRole("button", { name: "More, other sections" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("list")).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Taste", "/taste"],
      ["Calibration", "/calibration"],
      ["Spend", "/spend"],
      ["Connections", "/connections"],
    ]);
  });

  it("names the open section on the button when it is one behind More, and closes the list once a section opens", async () => {
    renderSignedIn(<Shell />, OWNER, "/taste");
    const more = screen.getByRole("button", { name: "Taste, more sections" });
    await userEvent.click(more);
    expect(screen.getByRole("link", { name: "Taste" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("link", { name: "Spend" }));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spend, more sections" })).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the list at Escape, with the focus back on the button, and at a click outside it", async () => {
    renderSignedIn(<Shell />, OWNER);
    const more = screen.getByRole("button", { name: "More, other sections" });
    await userEvent.click(more);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    await userEvent.click(more);
    expect(screen.getByRole("list")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("main"));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows Outreach to the owner only", () => {
    const { unmount } = renderSignedIn(<Shell />, OWNER);
    expect(screen.getByRole("link", { name: "Outreach" })).toBeInTheDocument();
    unmount();
    renderSignedIn(<Shell />, MEMBER);
    expect(screen.queryByRole("link", { name: "Outreach" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Packs" })).toBeInTheDocument();
  });

  it("shows beside each section how many wait there, and nothing at zero", async () => {
    counts({ studio: 2, outreach: 5, clients: 0, taste: 1, connections: 3 });
    renderSignedIn(<Shell />, OWNER);

    expect(await screen.findByRole("link", { name: waits("Studio, 11 waiting for you") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: waits("Outreach, 5 waiting for you") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clients" })).toBeInTheDocument();
    // The button counts what waits behind it, and hands the numbers to the list when it opens.
    const more = screen.getByRole("button", { name: waits("More, other sections, 4 waiting for you") });
    await userEvent.click(more);
    expect(more).toHaveAccessibleName("More, other sections");
    expect(screen.getByRole("link", { name: waits("Taste, 1 waiting for you") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: waits("Connections, 3 waiting for you") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Spend" })).toBeInTheDocument();
  });

  it("reads what waits again when another page opens", async () => {
    const calls = counts({ studio: 0 });
    renderSignedIn(<Shell />, OWNER);
    await userEvent.click(screen.getByRole("link", { name: "Brands" }));
    await waitFor(() => expect(calls.filter((call) => call === "GET /api/attention")).toHaveLength(2));
  });

  it("keeps the bar whole when what waits cannot be read", async () => {
    stubApi({ "GET /api/attention": () => ({ status: 500, body: {} }) });
    renderSignedIn(<Shell />, OWNER);
    await waitFor(() => expect(screen.getByRole("link", { name: "Studio" })).toBeInTheDocument());
    expect(screen.queryByText(/waiting for you/)).not.toBeInTheDocument();
  });

  it("holds every section and Sign out in one menu on a phone, with nothing in the bar to scroll", async () => {
    phone();
    counts({ studio: 1, outreach: 2, clients: 0, taste: 0, connections: 0 });
    renderSignedIn(<Shell />, OWNER, "/outreach");

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const menu = await screen.findByRole("button", { name: waits("Outreach, more sections, 3 waiting for you") });
    await userEvent.click(menu);
    expect(within(screen.getByRole("list")).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/", "/brands", "/outreach", "/packs", "/clients", "/taste", "/calibration", "/spend", "/connections"]);
    expect(screen.getByRole("link", { name: waits("Outreach, 2 waiting for you") })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: waits("Studio, 3 waiting for you") })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByText("owner@example.com · owner")).toBeInTheDocument();
  });

  it("calls the phone menu Menu on a page that is no section, and leaves the owner's sections out for a member", async () => {
    phone();
    counts({ studio: 0 });
    renderSignedIn(<Shell />, MEMBER, "/batches/b1");
    await userEvent.click(screen.getByRole("button", { name: "Menu, all sections" }));
    expect(within(screen.getByRole("list")).getAllByRole("link").map((link) => link.textContent)).toEqual(["Studio", "Brands", "Packs", "Taste", "Calibration", "Spend", "Connections"]);
  });

  it("shows the build at the foot of every page", async () => {
    stubApi({ "GET /api/health": () => ({ body: { ok: true, buildId: "abc123" } }) });
    renderSignedIn(<Shell />, OWNER, "/spend");
    expect(await screen.findByText("Build abc123")).toBeInTheDocument();
  });
});
