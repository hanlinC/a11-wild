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

  it("uploads the owner's own picture from his computer, and shows it as his ad with his yes", async () => {
    const own = adView({ from: "owner", batchId: "owner", verdict: "yes", why: "Your own picture, uploaded from your computer." });
    const calls = stubApi({
      [GET]: () => ({ body: prospectPage({ ads: [] }) }),
      "POST /api/outreach/prospects/00001/picture": (sent) => {
        const { type, bytes } = sent as { type: string; bytes: number };
        return { body: { uploadId: "u1", putUrl: `/put?type=${type}&bytes=${bytes}` } };
      },
      "PUT /put?type=image/png&bytes=3": () => ({ body: {} }),
      "POST /api/outreach/prospects/00001/picture/u1/done": () => ({ body: prospectPage({ ads: [own], message: { step: 0, messages: messages() } }) }),
    });
    const user = userEvent.setup();
    open();
    await user.upload(await screen.findByLabelText("Choose your picture"), new File(["PNG"], "ad.png", { type: "image/png" }));
    expect(await screen.findByText("Your upload")).toBeInTheDocument();
    expect(screen.getByText("You said yes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
    expect(screen.getByText("Ad 1 uploaded from your computer.")).toBeInTheDocument();
    expect(calls.filter((call) => !call.startsWith("GET"))).toEqual(["POST /api/outreach/prospects/00001/picture", "PUT /put?type=image/png&bytes=3", "POST /api/outreach/prospects/00001/picture/u1/done"]);
  });

  it("sends no file that is not a JPEG or a PNG, or that is too large, and says why the studio kept none", async () => {
    const calls = stubApi({
      [GET]: () => ({ body: prospectPage({ ads: [] }) }),
      "POST /api/outreach/prospects/00001/picture": () => ({ body: { uploadId: "u1", putUrl: "/put" } }),
      "PUT /put": () => ({ body: {} }),
      "POST /api/outreach/prospects/00001/picture/u1/done": () => ({ status: 400, body: { error: "refused", message: "This file is not a JPEG or a PNG picture. Nothing of it was kept." } }),
    });
    // applyAccept is off: a person can still drop any file on the field.
    const user = userEvent.setup({ applyAccept: false });
    open();
    const field = await screen.findByLabelText("Choose your picture");
    await user.upload(field, new File(["%PDF"], "ad.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("Choose a JPEG or a PNG picture.")).toBeInTheDocument();
    const large = new File(["x"], "ad.png", { type: "image/png" });
    Object.defineProperty(large, "size", { value: 8_000_001 });
    await user.upload(field, large);
    expect(await screen.findByText("The picture can be up to 8 MB.")).toBeInTheDocument();
    expect(calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
    await user.upload(field, new File(["MZ"], "ad.png", { type: "image/png" }));
    expect(await screen.findByText("This file is not a JPEG or a PNG picture. Nothing of it was kept.")).toBeInTheDocument();
  });

  it("offers no upload for a contact that opted out", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "opted_out" }) }) }) });
    open();
    expect(await screen.findByText(/This contact opted out/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose your picture")).not.toBeInTheDocument();
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
