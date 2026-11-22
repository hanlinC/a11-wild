import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adView, messages, prospectPage, prospectRow } from "@/outreach-fixtures";
import { renderSignedIn, stubApi } from "@/test-helpers";
import { Prospect } from "./prospect";

const open = () =>
  renderSignedIn(
    <Routes>
      <Route path="outreach/prospects/:id" element={<Prospect />} />
      <Route path="outreach/prospects" element={<p>The list</p>} />
    </Routes>,
    undefined,
    "/outreach/prospects/00001",
  );
const GET = "GET /api/outreach/prospects/00001";
const sendOf = (day: string) => ({ step: 0 as const, day, channel: "whatsapp" as const, title: "New ad for Koi Tea", text: "Hi", at: `${day}T03:00:00.000Z` });

afterEach(() => vi.restoreAllMocks());

describe("Prospect page", () => {
  it("shows the contact: a checked value as a link, any other as text", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ contact: { whatsapp: [{ number: "6580000001", href: "https://wa.me/6580000001" }], instagram: { name: "javascript:alert(1)" }, decisionMaker: "A Person", dmTitle: "Founder" } }) }) });
    open();
    expect(await screen.findByRole("link", { name: "+6580000001" })).toHaveAttribute("href", "https://wa.me/6580000001");
    expect(screen.getByText("javascript:alert(1)").closest("a")).toBeNull();
    expect(screen.getByText("A Person, Founder")).toBeInTheDocument();
  });

  it("shows the message to send now, and the timeline newest first", async () => {
    stubApi({
      [GET]: () => ({
        body: prospectPage({
          message: { step: 0, messages: messages() },
          events: [
            { id: "e2", type: "note", text: "Met at a fair.", at: "2026-11-23T02:00:00.000Z", by: "owner" },
            { id: "e1", type: "ad_yes", ad: 1, at: "2026-11-23T01:30:00.000Z", by: "owner" },
          ],
        }),
      }),
    });
    open();
    expect(await screen.findByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent).filter((text) => /Note|Yes to|attached/.test(text ?? "")).map((text) => text!.split(/You|The agent/)[0])).toEqual(["Note: Met at a fair.", "Yes to ad 1.", "Ad 1 attached: The cup on its own colour."]);
  });

  it("asks once before an opt-out, and the brand then offers no action", async () => {
    let asked = 0;
    stubApi({
      [GET]: () => ({ body: prospectPage() }),
      "POST /api/outreach/prospects/00001/optout": () => ((asked += 1), { body: prospectPage({ prospect: prospectRow({ stage: "opted_out" }) }) }),
    });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Opt this contact out" }));
    expect(asked).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Yes, opt out" }));
    expect(await screen.findByText(/This contact opted out/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save the note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  });

  it("offers take back on the day of the mark only", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "contacted" }), sends: [sendOf("2026-11-23")] }) }) });
    const { unmount } = open();
    expect(await screen.findByRole("button", { name: 'Take back "First message sent"' })).toBeInTheDocument();
    unmount();
    stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "contacted" }), sends: [sendOf("2026-11-20")] }) }) });
    open();
    expect(await screen.findByRole("button", { name: "They said more" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Take back/ })).not.toBeInTheDocument();
  });

  it("logs a reply of more with its text, and asks before a no", async () => {
    const sent: unknown[] = [];
    stubApi({
      [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "contacted" }), sends: [sendOf("2026-11-20")] }) }),
      "POST /api/outreach/prospects/00001/reply": (body) => (sent.push(body), { body: prospectPage({ prospect: prospectRow({ stage: "replied" }), sends: [sendOf("2026-11-20")], owed: { text: "Show me another.", at: "2026-11-23T03:00:00.000Z" } }) }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    open();
    await userEvent.type(await screen.findByLabelText(/Log a reply/), "Show me another.");
    await userEvent.click(screen.getByRole("button", { name: "They said no" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "They said more" }));
    expect(await screen.findByRole("heading", { name: "A reply waits for your answer" })).toBeInTheDocument();
    expect(sent).toEqual([{ reply: "more", text: "Show me another." }]);
  });

  it("removes a test prospect, and offers no removal for a brand of the list", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ ads: [adView()] }) }) });
    const { unmount } = open();
    expect(await screen.findByRole("button", { name: "Yes, send this ad" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove the test prospect" })).not.toBeInTheDocument();
    unmount();
    const calls = stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ test: true }) }) }), "POST /api/outreach/prospects/00001/remove": () => ({ body: { removed: true } }) });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Remove the test prospect" }));
    expect(await screen.findByText("The list")).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain("POST /api/outreach/prospects/00001/remove"));
  });
});
