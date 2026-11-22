import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBER, OWNER, renderSignedIn } from "@/test-helpers";
import { Shell } from "./shell";

describe("Shell", () => {
  const scrollIntoView = vi.fn();
  afterEach(() => {
    scrollIntoView.mockReset();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("brings the open section into view in the bar, as a phone may hold it out of sight", () => {
    Element.prototype.scrollIntoView = scrollIntoView;
    renderSignedIn(<Shell />, OWNER, "/clients");
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute("aria-current", "page");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("link", { name: "Clients" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

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

  it("scrolls nothing on a page that is no section", () => {
    Element.prototype.scrollIntoView = scrollIntoView;
    renderSignedIn(<Shell />, undefined, "/batches/b1");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
