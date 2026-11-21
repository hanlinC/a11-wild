import type { TastePage } from "@a11-wild/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MEMBER, renderSignedIn, stubApi } from "@/test-helpers";
import { Taste } from "./taste";

const v1 = { version: 1, text: "One clever object.", reason: "First canon.", savedBy: "owner@example.com", savedAt: "2026-11-21T10:00:00.000Z" };
const page = (overrides: Partial<TastePage> = {}): TastePage => ({ canon: v1, versions: [{ ...v1, text: undefined } as never], log: [], swipe: [], ...overrides });

describe("Taste page", () => {
  it("shows the canon, the owner's words in the log, and a saved reference", async () => {
    stubApi({
      "GET /api/taste": () => ({
        body: page({
          log: [{ id: "t1", at: "2026-11-21T10:00:00.000Z", kind: "pass", ownerSaid: "all three look like stock photos", savedBy: "owner@example.com" }],
          swipe: [{ id: "s1", title: "Lego shadow", why: "A brick casts the shadow of a ship.", source: "Blattner Brunner", addedAt: "2026-11-21T10:00:00.000Z", savedBy: "owner@example.com" }],
        }),
      }),
    });
    renderSignedIn(<Taste />);
    expect(await screen.findByText("One clever object.")).toBeInTheDocument();
    expect(screen.getByText("all three look like stock photos")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Lego shadow")).toBeInTheDocument();
  });

  it("saves an edit as a new version with its reason", async () => {
    let saved = false;
    const v2 = { ...v1, version: 2, text: "One clever object. No clutter.", reason: "He passed on a busy draft." };
    const calls = stubApi({
      "GET /api/taste": () => ({ body: saved ? page({ canon: v2, versions: [v2, v1] }) : page() }),
      "POST /api/taste/canon": () => {
        saved = true;
        return { body: v2 };
      },
    });
    renderSignedIn(<Taste />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("The whole canon"), " No clutter.");
    await userEvent.type(screen.getByLabelText("What changed, and why"), "He passed on a busy draft.");
    await userEvent.click(screen.getByRole("button", { name: "Save as version 2" }));

    await waitFor(() => expect(screen.getByText("One clever object. No clutter.")).toBeInTheDocument());
    expect(calls).toContain("POST /api/taste/canon");
    expect(screen.getByText(/Version 2 ·/)).toBeInTheDocument();
  });

  it("shows the studio's own words when a save is refused, and keeps the text", async () => {
    stubApi({
      "GET /api/taste": () => ({ body: page() }),
      "POST /api/taste/canon": () => ({ status: 400, body: { error: "refused", message: "A canon save needs a reason: one line on what changed and why." } }),
    });
    renderSignedIn(<Taste />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText("What changed, and why"), " ");
    await userEvent.click(screen.getByRole("button", { name: "Save as version 2" }));
    expect(await screen.findByText(/needs a reason/)).toBeInTheDocument();
    expect(screen.getByLabelText("The whole canon")).toHaveValue("One clever object.");
  });

  it("reads an old version", async () => {
    const v2 = { ...v1, version: 2, text: "Newer.", reason: "Changed." };
    stubApi({ "GET /api/taste": () => ({ body: page({ canon: v2, versions: [v2, v1] }) }), "GET /api/taste/canon/1": () => ({ body: v1 }) });
    renderSignedIn(<Taste />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Read" }))[1]!);
    expect(await screen.findByText("One clever object.")).toBeInTheDocument();
  });

  it("gives a member no way to edit the canon", async () => {
    stubApi({ "GET /api/taste": () => ({ body: page() }) });
    renderSignedIn(<Taste />, MEMBER);
    expect(await screen.findByText("One clever object.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
