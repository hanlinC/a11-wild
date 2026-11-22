import { screen } from "@testing-library/react";
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
    renderSignedIn(<Shell />, undefined, "/calibration");
    expect(screen.getByRole("link", { name: "Calibration" })).toHaveAttribute("aria-current", "page");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("link", { name: "Calibration" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
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
